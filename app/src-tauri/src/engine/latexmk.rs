//! Optional system TeX (TeX Live / MacTeX / MiKTeX) through `latexmk`, for documents
//! that need pdfLaTeX or LuaLaTeX. Apps started from Finder do not get the shell PATH,
//! so the usual install folders are searched too.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub latexmk: Option<PathBuf>,
    pub latexmk_version: Option<String>,
    /// First line of `--version` per engine (None = not installed).
    pub pdflatex: Option<String>,
    pub xelatex: Option<String>,
    pub lualatex: Option<String>,
}

fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    #[cfg(unix)]
    for d in ["/Library/TeX/texbin", "/usr/texbin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        dirs.push(PathBuf::from(d));
    }
    #[cfg(unix)]
    if let Ok(rd) = std::fs::read_dir("/usr/local/texlive") {
        // /usr/local/texlive/2026/bin/<arch>
        let mut years: Vec<PathBuf> = rd.flatten().map(|e| e.path().join("bin")).collect();
        years.sort();
        for y in years.into_iter().rev() {
            if let Ok(arch) = std::fs::read_dir(&y) {
                dirs.extend(arch.flatten().map(|e| e.path()));
            }
        }
    }
    #[cfg(windows)]
    {
        if let Ok(rd) = std::fs::read_dir("C:\\texlive") {
            let mut years: Vec<PathBuf> = rd.flatten().map(|e| e.path().join("bin").join("windows")).collect();
            years.sort();
            dirs.extend(years.into_iter().rev());
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            dirs.push(PathBuf::from(local).join("Programs\\MiKTeX\\miktex\\bin\\x64"));
        }
        dirs.push(PathBuf::from("C:\\Program Files\\MiKTeX\\miktex\\bin\\x64"));
    }
    dirs
}

fn find(name: &str) -> Option<PathBuf> {
    let file = format!("{name}{}", std::env::consts::EXE_SUFFIX);
    search_dirs().into_iter().map(|d| d.join(&file)).find(|p| p.is_file())
}

fn first_line(bin: &Path, arg: &str) -> Option<String> {
    let mut cmd = Command::new(bin);
    crate::core::hostenv::clean(&mut cmd);
    cmd.arg(arg);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().ok()?;
    let s = String::from_utf8_lossy(&out.stdout);
    s.lines().map(str::trim).find(|l| !l.is_empty()).map(str::to_string)
}

static DETECTED: Mutex<Option<Installed>> = Mutex::new(None);

/// What is installed (cached; `refresh` looks again, e.g. after installing TeX Live).
pub fn detect(refresh: bool) -> Installed {
    let mut g = DETECTED.lock().unwrap();
    if !refresh {
        if let Some(i) = g.as_ref() {
            return i.clone();
        }
    }
    let latexmk = find("latexmk");
    let version = |name: &str| find(name).and_then(|b| first_line(&b, "--version"));
    let i = Installed {
        latexmk_version: latexmk.as_ref().and_then(|b| first_line(b, "-v")).map(|l| {
            // "Latexmk, John Collins, 7 Apr. 2025. Version 4.87"
            l.rsplit("Version ").next().unwrap_or(&l).trim().to_string()
        }),
        latexmk,
        pdflatex: version("pdflatex"),
        xelatex: version("xelatex"),
        lualatex: version("lualatex"),
    };
    *g = Some(i.clone());
    i
}

/// `latexmk -pdf|-xelatex|-lualatex` for `main`, all outputs and aux files in `outdir`.
/// `flag` is the latexmk engine switch.
pub fn command(bin: &Path, flag: &str, main: &Path, outdir: &Path) -> Command {
    let mut cmd = Command::new(bin);
    cmd.arg(flag)
        .args(["-interaction=nonstopmode", "-file-line-error", "-synctex=1"])
        // Keep going past errors (reruns, bibtex): the PDF shows as much as possible.
        .arg("-f")
        .arg(format!("-outdir={}", outdir.display()))
        .arg(main.file_name().unwrap_or_default());
    if let Some(dir) = main.parent().filter(|d| !d.as_os_str().is_empty()) {
        cmd.current_dir(dir);
    }
    // latexmk calls pdflatex/bibtex by name: put the TeX bin folder first on PATH.
    if let Some(texbin) = bin.parent() {
        let mut paths = vec![texbin.to_path_buf()];
        if let Some(p) = std::env::var_os("PATH") {
            paths.extend(std::env::split_paths(&p));
        }
        if let Ok(joined) = std::env::join_paths(paths) {
            cmd.env("PATH", joined);
        }
    }
    cmd
}

/// One bare pass of the engine itself (no latexmk, no bibliography, no reruns) into the
/// same `outdir` latexmk uses, so references and citations still come from the aux/bbl
/// of the last full build. This is the typing preview: about half the time of a full run.
pub fn command_live(engine: &Path, main: &Path, outdir: &Path) -> Command {
    let mut cmd = Command::new(engine);
    cmd.args(["-interaction=nonstopmode", "-file-line-error", "-synctex=1"])
        .arg(format!("-output-directory={}", outdir.display()))
        .arg(main.file_name().unwrap_or_default());
    if let Some(dir) = main.parent().filter(|d| !d.as_os_str().is_empty()) {
        cmd.current_dir(dir);
    }
    if let Some(texbin) = engine.parent() {
        let mut paths = vec![texbin.to_path_buf()];
        if let Some(p) = std::env::var_os("PATH") {
            paths.extend(std::env::split_paths(&p));
        }
        if let Ok(joined) = std::env::join_paths(paths) {
            cmd.env("PATH", joined);
        }
    }
    cmd
}

/// Files a pass reads back from the previous one (references, TOC, bibliography).
const SEED_EXT: &[&str] = &["aux", "toc", "lof", "lot", "out", "bbl", "bcf", "xml", "nav", "snm", "vrb", "idx", "ind", "glo", "gls", "acn", "acr"];

/// The live pass works in its own folder so that a half-typed `\section{Pod` (an unclosed
/// brace swallows the end-of-file hook and writes garbage into `.toc`/`.aux`) can never
/// poison the files latexmk keeps. Before each pass the reference files of the last full
/// build are copied over (only when they differ), so `\ref`, `\cite` and the TOC still work.
pub fn seed_live(from: &Path, to: &Path, depth: usize) {
    if depth == 0 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(from) else { return };
    for e in rd.flatten() {
        let Ok(ft) = e.file_type() else { continue };
        let path = e.path();
        let dest = to.join(e.file_name());
        if ft.is_dir() {
            let _ = std::fs::create_dir_all(&dest);
            seed_live(&path, &dest, depth - 1);
        } else if ft.is_file() && path.extension().and_then(|x| x.to_str()).is_some_and(|x| SEED_EXT.contains(&x)) {
            let same = match (std::fs::metadata(&path), std::fs::metadata(&dest)) {
                (Ok(a), Ok(b)) => a.len() == b.len() && b.modified().ok() >= a.modified().ok(),
                _ => false,
            };
            if !same {
                let _ = std::fs::copy(&path, &dest);
            }
        }
    }
}

/// Deletes reference files that got LaTeX-internal macro names written into them (what an
/// unclosed brace at the end of an `\\input` file leaves in `.toc`/`.aux`). Every later run
/// reads such a file and fails the same way until it is regenerated — latexmk would not
/// notice, because the file looks "up to date". Returns how many were removed.
pub fn purge_poisoned(dir: &Path, depth: usize) -> usize {
    if depth == 0 {
        return 0;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return 0 };
    let mut n = 0;
    for e in rd.flatten() {
        let Ok(ft) = e.file_type() else { continue };
        let path = e.path();
        if ft.is_dir() {
            n += purge_poisoned(&path, depth - 1);
        } else if ft.is_file() && path.extension().and_then(|x| x.to_str()).is_some_and(|x| SEED_EXT.contains(&x)) {
            let small = e.metadata().is_ok_and(|m| m.len() < 2_000_000);
            if small && std::fs::read_to_string(&path).is_ok_and(|t| t.contains("@expl@@@filehook")) && std::fs::remove_file(&path).is_ok() {
                n += 1;
            }
        }
    }
    n
}

/// pdfLaTeX writes `outdir/<sub>/x.aux` for `\include{sub/x}` and fails when `<sub>`
/// does not exist there: mirror the source folders (shallow, no hidden/ignored ones).
pub fn mirror_dirs(src: &Path, outdir: &Path, depth: usize) {
    if depth == 0 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(src) else { return };
    for e in rd.flatten() {
        let name = e.file_name();
        let n = name.to_string_lossy();
        if n.starts_with('.') || crate::fs::tree::is_ignored_dir(&n) || !e.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let out = outdir.join(&name);
        let _ = std::fs::create_dir_all(&out);
        mirror_dirs(&e.path(), &out, depth - 1);
    }
}

#[cfg(test)]
mod seed_tests {
    use super::*;

    #[test]
    fn seeds_only_reference_files_and_never_overwrites_newer_ones() {
        let d = tempfile::tempdir().unwrap();
        let (from, to) = (d.path().join("latexmk"), d.path().join("live"));
        std::fs::create_dir_all(from.join("rozdzialy")).unwrap();
        std::fs::create_dir_all(&to).unwrap();
        std::fs::write(from.join("main.toc"), "toc").unwrap();
        std::fs::write(from.join("main.pdf"), "pdf").unwrap();
        std::fs::write(from.join("main.log"), "log").unwrap();
        std::fs::write(from.join("rozdzialy/a.aux"), "aux").unwrap();
        seed_live(&from, &to, 4);
        assert_eq!(std::fs::read_to_string(to.join("main.toc")).unwrap(), "toc");
        assert_eq!(std::fs::read_to_string(to.join("rozdzialy/a.aux")).unwrap(), "aux");
        assert!(!to.join("main.pdf").exists() && !to.join("main.log").exists());
        // A change of the source copy is picked up on the next pass.
        std::fs::write(from.join("main.toc"), "toc-2").unwrap();
        seed_live(&from, &to, 4);
        assert_eq!(std::fs::read_to_string(to.join("main.toc")).unwrap(), "toc-2");
    }

    #[test]
    fn purges_only_poisoned_reference_files() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("main.toc"), "\\contentsline {section}{\\numberline {2}\\@expl@@@filehook@file@pop@assign@@nnnn }{1}{section.2}").unwrap();
        std::fs::write(d.path().join("main.aux"), "fine").unwrap();
        assert_eq!(purge_poisoned(d.path(), 4), 1);
        assert!(!d.path().join("main.toc").exists() && d.path().join("main.aux").exists());
    }
}
