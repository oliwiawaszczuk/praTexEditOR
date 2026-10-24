//! Engine readiness. Tectonic downloads its format file and packages on the very first
//! compile (measured: ~1:40 on a fresh machine, then 0.3 s). We pay that once, in the
//! background, right after the first launch — so the first real document is fast.

use std::path::PathBuf;
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use super::process::Procs;
use super::tectonic::{self, Outcome};
use crate::core::jsonio::{read_json, write_json};
use crate::core::paths::Paths;
use crate::core::{err, CmdResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Checking,
    Warming,
    Ready,
    Error,
    Missing,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub phase: Phase,
    pub version: Option<String>,
    /// Warming: resource being fetched; error: short reason.
    pub detail: String,
    /// Warming: resources fetched so far.
    pub downloads: u32,
}

pub struct EngineState(Mutex<EngineStatus>, Condvar);

impl Default for EngineState {
    fn default() -> Self {
        Self(
            Mutex::new(EngineStatus {
                phase: Phase::Checking,
                version: None,
                detail: String::new(),
                downloads: 0,
            }),
            Condvar::new(),
        )
    }
}

impl EngineState {
    fn busy(s: &EngineStatus) -> bool {
        matches!(s.phase, Phase::Checking | Phase::Warming)
    }

    pub fn is_warm(&self) -> bool {
        !Self::busy(&self.0.lock().unwrap())
    }

    /// Block until the warm-up has finished (either way). Woken by `set`, no polling.
    pub fn wait_warm(&self) {
        let mut g = self.0.lock().unwrap();
        while Self::busy(&g) {
            g = self.1.wait(g).unwrap();
        }
    }
}

/// Persisted: the engine version that completed a warm-up on this machine.
#[derive(Default, Serialize, Deserialize)]
struct Marker {
    warm: Option<String>,
}

/// Same preamble as the built-in templates, so a fresh project compiles without downloads.
fn warmup_tex() -> String {
    format!(
        r"\documentclass[a4paper]{{article}}
{}
\usepackage{{amsmath,amssymb,graphicx,xcolor,booktabs,geometry,hyperref}}
\begin{{document}}
\tableofcontents
\section{{Rozgrzewka}}
Zażółć gęślą jaźń. $\int_0^1 x^2\,dx = \tfrac13$
\end{{document}}
",
        crate::projects::templates::PREAMBLE.trim_end()
    )
}

/// Bump when the warm-up document changes: machines warmed with the old one redo it.
const WARMUP_REV: u32 = 2;

const SELFTEST_TEX: &str = r"\documentclass{article}
\begin{document}
Hello, świat!
\end{document}
";

fn set(app: &AppHandle, f: impl FnOnce(&mut EngineStatus)) {
    let state = app.state::<EngineState>();
    let snapshot = {
        let mut s = state.0.lock().unwrap();
        f(&mut s);
        s.clone()
    };
    state.1.notify_all();
    let _ = app.emit("engine-status", snapshot);
}

fn write_doc(dir: PathBuf, tex: &str) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(&dir)?;
    let main = dir.join("main.tex");
    std::fs::write(&main, tex)?;
    Ok(main)
}

/// Started once from `setup`, on its own thread.
pub fn start_warmup(app: AppHandle) {
    std::thread::spawn(move || {
        let Some(bin) = tectonic::binary() else {
            set(&app, |s| {
                s.phase = Phase::Missing;
                s.detail = "brak binarki Tectonic obok aplikacji".into();
            });
            return;
        };
        let version = tectonic::version(&bin);
        let stamp = version.as_ref().map(|v| format!("{v}+w{WARMUP_REV}"));
        let paths = app.state::<Paths>().inner().clone();
        let marker: Marker = read_json(&paths.engine_marker());
        if stamp.is_some() && marker.warm == stamp {
            set(&app, |s| {
                s.phase = Phase::Ready;
                s.version = version;
            });
            return;
        }

        set(&app, |s| {
            s.phase = Phase::Warming;
            s.version = version.clone();
        });
        let dir = paths.scratch("warmup");
        let result = write_doc(dir.join("src"), &warmup_tex()).and_then(|main| {
            let mut last_emit = Instant::now() - Duration::from_secs(1);
            let mut count = 0u32;
            tectonic::compile(app.state::<Procs>().inner(), &bin, &main, &dir.join("out"), |line| {
                if let Some(name) = tectonic::downloading(line) {
                    count += 1;
                    // Throttled: hundreds of tiny files arrive in bursts.
                    if last_emit.elapsed() >= Duration::from_millis(200) {
                        last_emit = Instant::now();
                        let name = name.to_string();
                        set(&app, |s| {
                            s.detail = name;
                            s.downloads = count;
                        });
                    }
                }
            })
        });
        match result {
            Ok(o) if o.ok => {
                let _ = write_json(&paths.engine_marker(), &Marker { warm: stamp });
                let _ = std::fs::remove_dir_all(&dir);
                set(&app, |s| {
                    s.phase = Phase::Ready;
                    s.detail.clear();
                });
            }
            Ok(o) => set(&app, |s| {
                s.phase = Phase::Error;
                s.detail = o.tail.last().cloned().unwrap_or_else(|| "kompilacja nieudana".into());
            }),
            Err(e) => set(&app, |s| {
                s.phase = Phase::Error;
                s.detail = e.to_string();
            }),
        }
    });
}

#[tauri::command]
pub fn engine_status(state: State<'_, EngineState>) -> EngineStatus {
    state.0.lock().unwrap().clone()
}

/// Compile a one-line document; Ustawienia → Diagnostyka.
#[tauri::command]
pub async fn engine_selftest(app: AppHandle) -> CmdResult<Outcome> {
    tauri::async_runtime::spawn_blocking(move || {
        let bin = tectonic::binary().ok_or("brak binarki Tectonic")?;
        let dir = app.state::<Paths>().scratch("selftest");
        let main = write_doc(dir.join("src"), SELFTEST_TEX).map_err(err)?;
        tectonic::compile(app.state::<Procs>().inner(), &bin, &main, &dir.join("out"), |_| {})
            .map_err(err)
    })
    .await
    .map_err(err)?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    app_version: String,
    os: &'static str,
    arch: &'static str,
    data_dir: PathBuf,
    cache_dir: PathBuf,
    tectonic: Option<PathBuf>,
}

#[tauri::command]
pub fn diagnostics(app: AppHandle, paths: State<'_, Paths>) -> Diagnostics {
    Diagnostics {
        app_version: app.package_info().version.to_string(),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        data_dir: paths.data.clone(),
        cache_dir: paths.cache.clone(),
        tectonic: tectonic::binary(),
    }
}

/// Tectonic's own download cache (format file + packages), outside our folders.
fn tectonic_cache_dir(app: &AppHandle) -> Option<PathBuf> {
    let base = app.path().cache_dir().ok()?;
    Some(if cfg!(target_os = "macos") {
        base.join("TectonicProject.Tectonic")
    } else if cfg!(windows) {
        base.join("TectonicProject").join("Tectonic")
    } else {
        base.join("Tectonic")
    })
}

fn dir_size(p: &std::path::Path) -> u64 {
    let Ok(rd) = std::fs::read_dir(p) else { return 0 };
    rd.flatten()
        .map(|e| match e.file_type() {
            Ok(t) if t.is_dir() => dir_size(&e.path()),
            Ok(t) if t.is_file() => e.metadata().map(|m| m.len()).unwrap_or(0),
            _ => 0,
        })
        .sum()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheInfo {
    path: Option<PathBuf>,
    bytes: u64,
}

#[tauri::command]
pub async fn tectonic_cache(app: AppHandle) -> CmdResult<CacheInfo> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = tectonic_cache_dir(&app);
        let bytes = path.as_deref().map(dir_size).unwrap_or(0);
        CacheInfo { path, bytes }
    })
    .await
    .map_err(err)
}

/// Delete the package cache; the warm-up then downloads the basics again right away.
#[tauri::command]
pub async fn tectonic_cache_clear(app: AppHandle) -> CmdResult<()> {
    if !app.state::<EngineState>().is_warm() {
        return Err("Trwa rozgrzewka silnika".into());
    }
    if app.state::<super::build::Builds>().any_running() {
        return Err("Trwa kompilacja".into());
    }
    let dir = tectonic_cache_dir(&app).ok_or("Nie znaleziono folderu cache")?;
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        match std::fs::remove_dir_all(&dir) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.to_string()),
            _ => {}
        }
        let paths = app2.state::<Paths>();
        let _ = write_json(&paths.engine_marker(), &Marker::default());
        set(&app2, |s| s.phase = Phase::Checking);
        start_warmup(app2.clone());
        Ok(())
    })
    .await
    .map_err(err)?
}
