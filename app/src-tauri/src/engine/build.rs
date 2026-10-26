//! Project builds (docs/02-plan.md §3.1): a coalescing queue — at most one build per
//! project; a request that arrives meanwhile marks it dirty and exactly one more build
//! follows. A full build is never killed; a *live* pass (typing preview) is stale the
//! moment newer text exists, so a new request kills it and the newest one runs instead.
//! Everything the engine writes stays
//! in `<cache>/build/<pid>/`; the user's folders only get a PDF when asked to.
//!
//! Layout of `<cache>/build/<pid>/`:
//!   tectonic/   engine outdir (emptied before each run: PDF, SyncTeX, log only)
//!   latexmk/    engine outdir (kept: aux files make the next run incremental)
//!   live/       outdir of the typing-preview passes (seeded from latexmk/, never read back)
//!   doc.pdf, doc.synctex.gz, doc.log   the last published result (the viewer reads these)

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use super::latexmk;
use super::log::{self, Diagnostic, Resolver};
use super::process::{run_killable, Killer, Procs};
use super::status::EngineState;
use super::tectonic;
use crate::core::paths::Paths;
use crate::core::{err, CmdResult};
use crate::projects::registry::{Project, Projects};

const TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    #[default]
    Tectonic,
    Pdflatex,
    Xelatex,
    Lualatex,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildOpts {
    pub engine: Engine,
    /// Also copy an error-free PDF next to the main file.
    #[serde(default)]
    pub copy_pdf: bool,
    /// Live preview while typing: one bare pass of the engine (no bibliography, no
    /// reruns — it reads the aux files of the last full build). Only for system TeX;
    /// Tectonic always does its full run.
    #[serde(default)]
    pub live: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildResult {
    pub pid: String,
    /// Modification time (ms) of the published PDF; 0 = there is none yet. Changes with
    /// every new PDF, so the viewer knows when to reload.
    pub rev: u64,
    /// This run published a new PDF.
    pub fresh: bool,
    /// A PDF without errors.
    pub ok: bool,
    pub cancelled: bool,
    pub duration_ms: u64,
    pub engine: Engine,
    pub diagnostics: Vec<Diagnostic>,
    /// Failure outside the document (no engine, no main file, timeout, no network).
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildProgress {
    pub pid: String,
    /// "running" | "waiting" (engine warm-up) | "downloading" (Tectonic packages)
    pub phase: &'static str,
    pub downloads: u32,
    pub detail: String,
}

#[derive(Default)]
struct Slot {
    running: bool,
    /// The running build is a live pass (a newer request replaces it at once).
    live_running: bool,
    again: Option<BuildOpts>,
    killer: Option<Arc<Killer>>,
    last: Option<BuildResult>,
}

#[derive(Default)]
pub struct Builds(Mutex<HashMap<String, Slot>>);

impl Builds {
    pub fn any_running(&self) -> bool {
        self.0.lock().unwrap().values().any(|s| s.running)
    }
}

fn mtime_ms(p: &Path) -> u64 {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn published_pdf(paths: &Paths, pid: &str) -> PathBuf {
    paths.build_dir(pid).join("doc.pdf")
}

/// Copy (or move) `from` onto `to` through a hidden sibling + rename: a reader never
/// sees half a file, and the watcher ignores `.pratex~` names.
fn put(from: &Path, to: &Path, keep_source: bool) -> std::io::Result<()> {
    let name = to.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = to.with_file_name(format!(".{name}.pratex~"));
    // A move across volumes falls back to a copy.
    if keep_source || std::fs::rename(from, &tmp).is_err() {
        std::fs::copy(from, &tmp)?;
    }
    std::fs::rename(&tmp, to)
}

fn emit_progress(app: &AppHandle, pid: &str, phase: &'static str, downloads: u32, detail: &str) {
    let _ = app.emit(
        "build-progress",
        BuildProgress {
            pid: pid.to_string(),
            phase,
            downloads,
            detail: detail.to_string(),
        },
    );
}

fn diagnostics_of(log_path: &Path, project: &Project, main: &Path, engine_errors: &[String]) -> Vec<Diagnostic> {
    let base = main.parent().unwrap_or(Path::new("."));
    let mut res = Resolver::new(base, &project.roots);
    let mut ds = match std::fs::read(log_path) {
        Ok(bytes) => log::parse(&String::from_utf8_lossy(&bytes), &mut res),
        Err(_) => Vec::new(),
    };
    if !ds.iter().any(|d| d.severity == log::Severity::Error) {
        ds.splice(0..0, log::parse_engine_errors(engine_errors, &mut res));
    }
    ds
}

struct Run {
    diagnostics: Vec<Diagnostic>,
    fresh: bool,
    message: Option<String>,
    cancelled: bool,
}

fn fail(msg: impl Into<String>) -> Run {
    Run {
        diagnostics: Vec::new(),
        fresh: false,
        message: Some(msg.into()),
        cancelled: false,
    }
}

fn run_once(app: &AppHandle, pid: &str, opts: &BuildOpts, killer: &Arc<Killer>) -> Run {
    let Ok(project) = app.state::<Projects>().get(pid) else {
        return fail("Nie ma takiego projektu");
    };
    let Some(main) = project.main.clone() else {
        return fail("Projekt nie ma pliku głównego — wskaż go w drzewie (menu pliku → ★)");
    };
    if !main.is_file() {
        return fail(format!(
            "Nie ma pliku głównego {}",
            main.file_name().map(|n| n.to_string_lossy()).unwrap_or_default()
        ));
    }
    let paths = app.state::<Paths>().inner().clone();
    let build = paths.build_dir(pid);
    let stem = main.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "main".into());

    let (cmd, work) = match opts.engine {
        Engine::Tectonic => {
            let Some(bin) = tectonic::binary() else {
                return fail("Brak binarki Tectonic obok aplikacji");
            };
            // The first-launch warm-up downloads the same bundle: wait for it (no polling).
            if !app.state::<EngineState>().is_warm() {
                emit_progress(app, pid, "waiting", 0, "");
                app.state::<EngineState>().wait_warm();
            }
            let work = build.join("tectonic");
            let _ = std::fs::remove_dir_all(&work);
            if let Err(e) = std::fs::create_dir_all(&work) {
                return fail(e.to_string());
            }
            (tectonic::build_command(&bin, &main, &work), work)
        }
        engine => {
            let inst = latexmk::detect(false);
            let Some(bin) = inst.latexmk else {
                return fail("Nie znaleziono latexmk — zainstaluj TeX Live (MacTeX) albo wybierz Tectonic");
            };
            let (flag, have, name) = match engine {
                Engine::Pdflatex => ("-pdf", inst.pdflatex.is_some(), "pdfLaTeX"),
                Engine::Xelatex => ("-xelatex", inst.xelatex.is_some(), "XeLaTeX"),
                _ => ("-lualatex", inst.lualatex.is_some(), "LuaLaTeX"),
            };
            if !have {
                return fail(format!("Nie znaleziono {name} w instalacji TeX"));
            }
            let work = build.join(if opts.live { "live" } else { "latexmk" });
            if let Err(e) = std::fs::create_dir_all(&work) {
                return fail(e.to_string());
            }
            if let Some(src) = main.parent() {
                latexmk::mirror_dirs(src, &work, 4);
            }
            if opts.live {
                latexmk::seed_live(&build.join("latexmk"), &work, 4);
            }
            if opts.live {
                let tex = bin.parent().map(|d| d.join(match engine {
                    Engine::Pdflatex => "pdflatex",
                    Engine::Xelatex => "xelatex",
                    _ => "lualatex",
                }));
                match tex.filter(|t| t.is_file()) {
                    Some(t) => (latexmk::command_live(&t, &main, &work), work),
                    None => (latexmk::command(&bin, flag, &main, &work), work),
                }
            } else {
                latexmk::purge_poisoned(&work, 4);
                (latexmk::command(&bin, flag, &main, &work), work)
            }
        }
    };

    emit_progress(app, pid, "running", 0, "");
    let started = SystemTime::now();

    // Watchdog: sleeps until the build ends (sender dropped) or the timeout passes.
    let timed_out = Arc::new(AtomicBool::new(false));
    let (done_tx, done_rx) = mpsc::channel::<()>();
    {
        let killer = killer.clone();
        let timed_out = timed_out.clone();
        std::thread::spawn(move || {
            if done_rx.recv_timeout(TIMEOUT) == Err(mpsc::RecvTimeoutError::Timeout) {
                timed_out.store(true, Ordering::SeqCst);
                killer.kill();
            }
        });
    }

    let mut engine_errors: Vec<String> = Vec::new();
    let mut tail: Vec<String> = Vec::new();
    let mut downloads = 0u32;
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    let status = run_killable(app.state::<Procs>().inner(), Some(killer), cmd, |line| {
        if let Some(name) = tectonic::downloading(line) {
            downloads += 1;
            if last_emit.elapsed() >= Duration::from_millis(200) {
                last_emit = Instant::now();
                emit_progress(app, pid, "downloading", downloads, name);
            }
        } else if line.starts_with("error: ") {
            engine_errors.push(line.to_string());
        }
        if tail.len() == 20 {
            tail.remove(0);
        }
        tail.push(line.to_string());
    });
    drop(done_tx);

    if killer.was_killed() {
        if timed_out.load(Ordering::SeqCst) {
            return fail("Kompilacja trwała ponad 2 minuty — przerwana (pętla w dokumencie?)");
        }
        return Run {
            diagnostics: Vec::new(),
            fresh: false,
            message: None,
            cancelled: true,
        };
    }
    let status = match status {
        Ok(s) => s,
        Err(e) => return fail(format!("Nie udało się uruchomić silnika: {e}")),
    };

    let pdf = work.join(format!("{stem}.pdf"));
    let log_file = work.join(format!("{stem}.log"));
    let synctex = work.join(format!("{stem}.synctex.gz"));
    let keep = opts.engine != Engine::Tectonic; // latexmk keeps its outdir
    let fresh = std::fs::metadata(&pdf)
        .and_then(|m| m.modified())
        .is_ok_and(|t| t + Duration::from_secs(2) >= started)
        // latexmk keeps its outdir and rewrites nothing when the sources are unchanged
        // (e.g. the build on open): a successful run with an existing PDF is up to date.
        || (keep && status.success() && pdf.is_file());

    if log_file.is_file() {
        let _ = put(&log_file, &build.join("doc.log"), true);
    }
    if fresh {
        if synctex.is_file() {
            let _ = put(&synctex, &build.join("doc.synctex.gz"), keep);
        } else {
            let _ = std::fs::remove_file(build.join("doc.synctex.gz"));
        }
        if let Err(e) = put(&pdf, &build.join("doc.pdf"), keep) {
            return fail(format!("Nie udało się zapisać PDF: {e}"));
        }
    }

    let diagnostics = diagnostics_of(&build.join("doc.log"), &project, &main, &engine_errors);
    let errors = log::counts(&diagnostics).0;
    let mut message = None;
    if !fresh && errors == 0 {
        let last = tail.iter().rev().find(|l| l.starts_with("error:")).or(tail.last()).cloned().unwrap_or_default();
        let offline = tail.iter().any(|l| l.contains("failed to") && (l.contains("download") || l.contains("http") || l.contains("network")));
        message = Some(if offline {
            "Brak sieci: Tectonic nie pobrał pakietów (po pierwszym pobraniu działa offline)".to_string()
        } else if status.success() {
            "Silnik nie utworzył PDF".to_string()
        } else {
            last.trim_start_matches("error: ").to_string()
        });
    }

    if fresh && errors == 0 && opts.copy_pdf && !opts.live {
        let _ = put(&build.join("doc.pdf"), &main.with_extension("pdf"), true);
    }
    Run {
        diagnostics,
        fresh,
        message,
        cancelled: false,
    }
}

fn worker(app: AppHandle, pid: String, mut opts: BuildOpts, mut killer: Arc<Killer>) {
    loop {
        let started = Instant::now();
        let run = run_once(&app, &pid, &opts, &killer);
        if run.fresh {
            crate::synctex::warm(&app, &pid);
        }
        let paths = app.state::<Paths>();
        let rev = mtime_ms(&published_pdf(&paths, &pid));
        let errors = log::counts(&run.diagnostics).0;
        let result = BuildResult {
            pid: pid.clone(),
            rev,
            ok: run.fresh && errors == 0 && run.message.is_none(),
            fresh: run.fresh,
            cancelled: run.cancelled,
            duration_ms: started.elapsed().as_millis() as u64,
            engine: opts.engine,
            diagnostics: run.diagnostics,
            message: run.message,
        };
        let next = {
            let builds = app.state::<Builds>();
            let mut map = builds.0.lock().unwrap();
            let slot = map.entry(pid.clone()).or_default();
            // A cancelled run keeps the previous result (its PDF is still shown).
            if !result.cancelled {
                slot.last = Some(result.clone());
            }
            match slot.again.take() {
                Some(o) => {
                    let k = Arc::new(Killer::default());
                    slot.killer = Some(k.clone());
                    slot.live_running = o.live;
                    Some((o, k))
                }
                None => {
                    slot.running = false;
                    slot.live_running = false;
                    slot.killer = None;
                    None
                }
            }
        };
        let _ = app.emit("build-done", &result);
        match next {
            Some((o, k)) => {
                opts = o;
                killer = k;
            }
            None => break,
        }
    }
}

#[tauri::command]
pub fn build_request(app: AppHandle, builds: State<'_, Builds>, pid: String, opts: BuildOpts) -> CmdResult<()> {
    let mut map = builds.0.lock().map_err(err)?;
    let slot = map.entry(pid.clone()).or_default();
    if slot.running {
        // A queued full build is never downgraded to a live one.
        let queued_full = slot.again.as_ref().is_some_and(|a| !a.live);
        if !(opts.live && queued_full) {
            slot.again = Some(opts);
        }
        // The running live pass is already stale: stop it, the queued request runs next.
        if slot.live_running {
            if let Some(k) = &slot.killer {
                k.kill();
            }
        }
        return Ok(());
    }
    slot.running = true;
    slot.live_running = opts.live;
    let killer = Arc::new(Killer::default());
    slot.killer = Some(killer.clone());
    drop(map);
    std::thread::spawn(move || worker(app, pid, opts, killer));
    Ok(())
}

/// Stop the running build (and drop a queued one). The last PDF stays.
#[tauri::command]
pub fn build_cancel(builds: State<'_, Builds>, pid: String) {
    let mut map = builds.0.lock().unwrap();
    if let Some(slot) = map.get_mut(&pid) {
        slot.again = None;
        if let Some(k) = &slot.killer {
            k.kill();
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildState {
    pub running: bool,
    pub last: Option<BuildResult>,
}

/// For a freshly opened project view: is a build running, and the last result — after a
/// restart rebuilt from the published files, so the previous PDF shows at once.
#[tauri::command]
pub async fn build_state(app: AppHandle, pid: String) -> CmdResult<BuildState> {
    {
        let builds = app.state::<Builds>();
        let map = builds.0.lock().map_err(err)?;
        if let Some(slot) = map.get(&pid) {
            if slot.running || slot.last.is_some() {
                return Ok(BuildState {
                    running: slot.running,
                    last: slot.last.clone(),
                });
            }
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        let paths = app.state::<Paths>();
        let pdf = published_pdf(&paths, &pid);
        let project = app.state::<Projects>().get(&pid)?;
        if !pdf.is_file() {
            return Ok(BuildState { running: false, last: None });
        }
        let diagnostics = match &project.main {
            Some(main) => diagnostics_of(&paths.build_dir(&pid).join("doc.log"), &project, main, &[]),
            None => Vec::new(),
        };
        let errors = log::counts(&diagnostics).0;
        Ok(BuildState {
            running: false,
            last: Some(BuildResult {
                pid,
                rev: mtime_ms(&pdf),
                fresh: false,
                ok: errors == 0,
                cancelled: false,
                duration_ms: 0,
                engine: Engine::Tectonic,
                diagnostics,
                message: None,
            }),
        })
    })
    .await
    .map_err(err)?
}

/// The raw log, on request only (drawer → "surowy log").
#[tauri::command]
pub fn build_log(paths: State<'_, Paths>, pid: String) -> CmdResult<String> {
    let bytes = std::fs::read(paths.build_dir(&pid).join("doc.log")).map_err(|_| "Nie ma jeszcze logu".to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Forget build outputs of a project (next build starts from scratch).
#[tauri::command]
pub fn build_clean(app: AppHandle, paths: State<'_, Paths>, pid: String) -> CmdResult<()> {
    if let Some(slot) = app.state::<Builds>().0.lock().map_err(err)?.get_mut(&pid) {
        if slot.running {
            return Err("Trwa kompilacja".into());
        }
        slot.last = None;
    }
    match std::fs::remove_dir_all(paths.build_dir(&pid)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// Export the current PDF. `ask = false`: next to the main file (`main.pdf`); `ask`:
/// the system "Save as" dialog — opened here in Rust, so the path never comes from the
/// webview. Returns where it went (None = dialog cancelled).
#[tauri::command]
pub async fn pdf_export(app: AppHandle, pid: String, ask: bool) -> CmdResult<Option<PathBuf>> {
    tauri::async_runtime::spawn_blocking(move || {
        let src = published_pdf(&app.state::<Paths>(), &pid);
        if !src.is_file() {
            return Err("Nie ma jeszcze PDF — skompiluj dokument".to_string());
        }
        let project = app.state::<Projects>().get(&pid)?;
        let main = project.main.clone().ok_or("Projekt nie ma pliku głównego")?;
        let next_to_main = crate::fs::guard::inside(&project, &main.with_extension("pdf"))?;
        let dest = if ask {
            use tauri_plugin_dialog::DialogExt;
            let mut d = app
                .dialog()
                .file()
                .add_filter("PDF", &["pdf"])
                .set_file_name(next_to_main.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
            if let Some(dir) = main.parent() {
                d = d.set_directory(dir);
            }
            match d.blocking_save_file() {
                Some(p) => p.into_path().map_err(err)?,
                None => return Ok(None),
            }
        } else {
            next_to_main
        };
        put(&src, &dest, true).map_err(|e| format!("Nie udało się zapisać PDF: {e}"))?;
        Ok(Some(dest))
    })
    .await
    .map_err(err)?
}

/// Open the current PDF in the system viewer (Preview, …).
#[tauri::command]
pub fn pdf_open_external(paths: State<'_, Paths>, pid: String) -> CmdResult<()> {
    let pdf = published_pdf(&paths, &pid);
    if !pdf.is_file() {
        return Err("Nie ma jeszcze PDF".into());
    }
    crate::fs::ops::open_default(&pdf).map_err(err)
}

/// A web / mail link clicked in the PDF opens in the default app. Only http(s) and mailto,
/// and nothing a shell could read as more than one argument.
#[tauri::command]
pub fn open_url(url: String) -> CmdResult<()> {
    let ok_scheme = ["http://", "https://", "mailto:"].iter().any(|s| url.to_ascii_lowercase().starts_with(s));
    let clean = !url.chars().any(|c| c.is_whitespace() || c.is_control() || "&|<>^\"`$;".contains(c));
    if !ok_scheme || !clean || url.len() > 2048 {
        return Err("Ten adres nie może być otwarty z PDF".into());
    }
    crate::fs::ops::open_default(Path::new(&url)).map_err(err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Engines {
    pub tectonic: Option<String>,
    pub tex: latexmk::Installed,
}

#[tauri::command]
pub async fn engines_detect(refresh: bool) -> CmdResult<Engines> {
    tauri::async_runtime::spawn_blocking(move || Engines {
        tectonic: tectonic::binary().and_then(|b| tectonic::version(&b)),
        tex: latexmk::detect(refresh),
    })
    .await
    .map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn put_replaces_atomically() {
        let d = tempfile::tempdir().unwrap();
        let a = d.path().join("a.pdf");
        let b = d.path().join("b.pdf");
        std::fs::write(&a, "new").unwrap();
        std::fs::write(&b, "old").unwrap();
        put(&a, &b, true).unwrap();
        assert_eq!(std::fs::read_to_string(&b).unwrap(), "new");
        assert!(a.is_file());
        put(&a, &b, false).unwrap();
        assert!(!a.exists());
        assert_eq!(std::fs::read_dir(d.path()).unwrap().count(), 1);
    }
}
