//! Finding the main `.tex` file of a folder: `\documentclass` + `\begin{document}`
//! outside comments, shallow first, conventional names first.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::fs::tree::is_ignored_dir;

const MAX_DEPTH: usize = 3;
const MAX_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MainCandidate {
    pub path: PathBuf,
    /// Relative to the searched folder, for display.
    pub rel: String,
    /// `\documentclass` line and `\title{…}` when present.
    pub preview: Vec<String>,
}

pub fn find_mains(root: &Path) -> Vec<MainCandidate> {
    let mut out = Vec::new();
    walk(root, root, 0, &mut out);
    out.sort_by_key(|c| (rank(&c.path), c.rel.matches('/').count(), c.rel.clone()));
    out
}

fn rank(p: &Path) -> u8 {
    match p.file_stem().and_then(|s| s.to_str()).unwrap_or("") {
        "main" => 0,
        "thesis" | "praca" | "report" | "raport" | "paper" | "artykul" => 1,
        _ => 2,
    }
}

fn walk(root: &Path, dir: &Path, depth: usize, out: &mut Vec<MainCandidate>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for e in rd.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() {
            if depth < MAX_DEPTH && !is_ignored_dir(&name) && !name.starts_with('.') {
                walk(root, &p, depth + 1, out);
            }
        } else if name.ends_with(".tex") && e.metadata().map(|m| m.len() <= MAX_BYTES).unwrap_or(false) {
            if let Some(preview) = std::fs::read(&p).ok().and_then(|b| inspect(&String::from_utf8_lossy(&b))) {
                let rel = p
                    .strip_prefix(root)
                    .unwrap_or(&p)
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push(MainCandidate { path: p, rel, preview });
            }
        }
    }
}

/// `Some(preview)` when the text is a standalone document.
pub fn inspect(text: &str) -> Option<Vec<String>> {
    let mut class = None;
    let mut title = None;
    let mut begin = false;
    for line in text.lines() {
        let code = strip_comment(line).trim();
        if code.is_empty() {
            continue;
        }
        if class.is_none() && code.contains("\\documentclass") {
            class = Some(code.to_string());
        }
        if title.is_none() && code.starts_with("\\title") {
            title = Some(code.to_string());
        }
        if code.contains("\\begin{document}") {
            begin = true;
            break;
        }
    }
    let class = class?;
    begin.then(|| std::iter::once(class).chain(title).collect())
}

/// Code part of a line: up to the first `%` not escaped as `\%`.
fn strip_comment(line: &str) -> &str {
    let b = line.as_bytes();
    for i in 0..b.len() {
        if b[i] == b'%' && (i == 0 || b[i - 1] != b'\\') {
            return &line[..i];
        }
    }
    line
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standalone_only() {
        assert!(inspect("\\documentclass{article}\n\\title{X}\n\\begin{document}\n").is_some());
        assert!(inspect("\\chapter{Wstęp}\nTekst").is_none());
        assert!(inspect("% \\documentclass{article}\n\\begin{document}").is_none());
        assert!(inspect("\\documentclass{article}\n% \\begin{document}").is_none());
    }

    #[test]
    fn prefers_main_and_shallow() {
        let d = tempfile::tempdir().unwrap();
        let doc = "\\documentclass{article}\\begin{document}x\\end{document}";
        std::fs::create_dir_all(d.path().join("a/b")).unwrap();
        std::fs::write(d.path().join("a/b/main.tex"), doc).unwrap();
        std::fs::write(d.path().join("zz.tex"), doc).unwrap();
        std::fs::write(d.path().join("main.tex"), doc).unwrap();
        std::fs::write(d.path().join("rozdzial.tex"), "\\chapter{x}").unwrap();
        let c = find_mains(d.path());
        let rels: Vec<_> = c.iter().map(|c| c.rel.as_str()).collect();
        assert_eq!(rels, ["main.tex", "a/b/main.tex", "zz.tex"]);
    }
}
