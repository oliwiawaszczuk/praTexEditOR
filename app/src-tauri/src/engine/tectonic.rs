//! The bundled Tectonic CLI (`externalBin` → next to our executable).

use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

use serde::Serialize;

use super::process::{run_streaming, Procs};

/// Tauri puts external binaries next to the main executable, with the target-triple
/// suffix stripped — in `tauri dev` too (copied into target/debug).
pub fn binary() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let bin = exe
        .parent()?
        .join(format!("tectonic{}", std::env::consts::EXE_SUFFIX));
    bin.is_file().then_some(bin)
}

pub fn version(bin: &Path) -> Option<String> {
    let mut cmd = Command::new(bin);
    cmd.arg("--version");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().ok()?;
    let s = String::from_utf8_lossy(&out.stdout);
    // "Tectonic 0.17.0"
    s.split_whitespace().nth(1).map(str::to_string)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub ok: bool,
    pub duration_ms: u64,
    pub pdf: Option<PathBuf>,
    /// Last lines of engine output — shown when something fails.
    pub tail: Vec<String>,
}

/// One compile of `main` with outputs (PDF, log, aux, synctex) in `outdir`.
/// Working dir = the folder of `main`, so relative `\input`/`\includegraphics` behave
/// exactly as with a manual run. `on_line` gets every output line.
pub fn compile(
    procs: &Procs,
    bin: &Path,
    main: &Path,
    outdir: &Path,
    mut on_line: impl FnMut(&str),
) -> io::Result<Outcome> {
    std::fs::create_dir_all(outdir)?;
    let mut cmd = Command::new(bin);
    cmd.arg("-X")
        .arg("compile")
        .arg(main.file_name().unwrap_or_default())
        .arg("--outdir")
        .arg(outdir)
        .args(["--keep-intermediates", "--keep-logs", "--synctex"]);
    if let Some(dir) = main.parent().filter(|d| !d.as_os_str().is_empty()) {
        cmd.current_dir(dir);
    }

    let started = Instant::now();
    let mut tail: Vec<String> = Vec::new();
    let status = run_streaming(procs, cmd, |line| {
        if tail.len() == 40 {
            tail.remove(0);
        }
        tail.push(line.to_string());
        on_line(line);
    })?;
    let pdf = outdir.join(main.with_extension("pdf").file_name().unwrap_or_default());
    Ok(Outcome {
        ok: status.success() && pdf.is_file(),
        duration_ms: started.elapsed().as_millis() as u64,
        pdf: pdf.is_file().then_some(pdf),
        tail,
    })
}

/// A project build: only the PDF, its SyncTeX data and the log come out (in `outdir`,
/// the app cache) — Tectonic keeps aux/bbl/toc in memory and reruns by itself.
/// `continue-on-errors`: like Overleaf, a document with errors still gives a PDF.
pub fn build_command(bin: &Path, main: &Path, outdir: &Path) -> Command {
    let mut cmd = Command::new(bin);
    cmd.arg("-X")
        .arg("compile")
        .arg(main.file_name().unwrap_or_default())
        .arg("--outdir")
        .arg(outdir)
        .args(["--synctex", "--keep-logs", "-Z", "continue-on-errors"]);
    if let Some(dir) = main.parent().filter(|d| !d.as_os_str().is_empty()) {
        cmd.current_dir(dir);
    }
    cmd
}

/// Name of a resource Tectonic is fetching, from its `note: downloading <name>` line.
pub fn downloading(line: &str) -> Option<&str> {
    line.strip_prefix("note: downloading ").map(str::trim)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real compile with the binary from scripts/fetch-tectonic.sh. Ignored by default:
    /// a cold Tectonic cache downloads packages (CI covers it in the `tectonic` job).
    /// Run: cargo test -- --ignored
    #[test]
    #[ignore]
    fn compiles_with_bundled_binary() {
        let triple = env!("TARGET_TRIPLE");
        let bin = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!("tectonic-{triple}{}", std::env::consts::EXE_SUFFIX));
        assert!(bin.is_file(), "run scripts/fetch-tectonic.sh first");
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src");
        std::fs::create_dir_all(&src).unwrap();
        let main = src.join("main.tex");
        std::fs::write(&main, "\\documentclass{article}\\begin{document}Zażółć\\end{document}\n").unwrap();
        let mut lines = 0;
        let out = compile(&Procs::default(), &bin, &main, &dir.path().join("out"), |_| lines += 1).unwrap();
        assert!(out.ok, "{:?}", out.tail);
        assert!(out.pdf.unwrap().is_file());
        assert!(dir.path().join("out/main.synctex.gz").is_file());
        assert!(lines > 0);
        // Sources stay clean: nothing written next to main.tex.
        assert_eq!(std::fs::read_dir(&src).unwrap().count(), 1);
    }

    /// A project build leaves exactly PDF + SyncTeX + log in the outdir, nothing in the
    /// sources, and still gives a PDF when the document has errors.
    #[test]
    #[ignore]
    fn build_outputs_only_three_files() {
        let triple = env!("TARGET_TRIPLE");
        let bin = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!("tectonic-{triple}{}", std::env::consts::EXE_SUFFIX));
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src");
        let out = dir.path().join("out");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::create_dir_all(&out).unwrap();
        let main = src.join("main.tex");
        std::fs::write(&main, "\\documentclass{article}\\begin{document}\\section{A}\\label{a}Zażółć \\ref{a} \\nieznana\\end{document}\n").unwrap();
        let st = run_streaming(&Procs::default(), build_command(&bin, &main, &out), |_| {}).unwrap();
        assert!(st.success());
        let mut names: Vec<String> = std::fs::read_dir(&out).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        assert_eq!(names, ["main.log", "main.pdf", "main.synctex.gz"]);
        assert_eq!(std::fs::read_dir(&src).unwrap().count(), 1);
    }

    #[test]
    fn parses_download_notes() {
        assert_eq!(downloading("note: downloading glyphlist.txt"), Some("glyphlist.txt"));
        assert_eq!(downloading("note: Writing `main.pdf`"), None);
    }
}
