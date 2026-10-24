//! Directory listing for the lazy file tree: one folder per call, sorted like Finder
//! (folders first, natural order — `rozdzial2` before `rozdzial10`).

use std::cmp::Ordering;
use std::io;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: PathBuf,
    pub dir: bool,
    pub size: u64,
    pub mtime: u64,
}

/// Folders never worth showing or watching.
pub fn is_ignored_dir(name: &str) -> bool {
    matches!(name, ".git" | "node_modules" | "__pycache__" | ".svn" | ".hg" | ".venv" | "target")
}

/// TeX by-products (they go to our cache when we compile; others' builds may leave them).
pub fn is_aux_file(name: &str) -> bool {
    const AUX: &[&str] = &[
        ".aux", ".log", ".synctex.gz", ".synctex", ".fdb_latexmk", ".fls", ".out", ".toc", ".bbl",
        ".blg", ".bcf", ".run.xml", ".xdv", ".lof", ".lot", ".nav", ".snm", ".vrb", ".idx", ".ilg",
        ".ind", ".glo", ".gls", ".glg", ".ist", ".acn", ".acr", ".alg", ".loa", ".thm", ".dvi",
    ];
    let lower = name.to_ascii_lowercase();
    AUX.iter().any(|e| lower.ends_with(e))
}

#[derive(Debug, Clone, Copy, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Visibility {
    /// Dotfiles (except ignored dirs, which never show).
    pub hidden: bool,
    /// TeX auxiliary files.
    pub aux: bool,
}

pub fn visible(name: &str, dir: bool, v: Visibility) -> bool {
    if dir && is_ignored_dir(name) {
        return false;
    }
    if name == ".DS_Store" || name == "Thumbs.db" || name == "desktop.ini" {
        return false;
    }
    if name.starts_with('.') && !v.hidden {
        return false;
    }
    dir || v.aux || !is_aux_file(name)
}

pub fn list(dir: &Path, v: Visibility) -> io::Result<Vec<Entry>> {
    let mut out: Vec<Entry> = std::fs::read_dir(dir)?
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            // Follow symlinks: a linked folder behaves like a folder.
            let meta = std::fs::metadata(e.path()).ok()?;
            let dir = meta.is_dir();
            visible(&name, dir, v).then(|| Entry {
                path: e.path(),
                dir,
                size: if dir { 0 } else { meta.len() },
                mtime: meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0),
                name,
            })
        })
        .collect();
    out.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| natural_cmp(&a.name, &b.name)));
    Ok(out)
}

/// Case-insensitive, digit runs compared by value.
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (mut a, mut b) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (a.peek().copied(), b.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, _) => return Ordering::Less,
            (_, None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let na: String = std::iter::from_fn(|| a.next_if(|c| c.is_ascii_digit())).collect();
                let nb: String = std::iter::from_fn(|| b.next_if(|c| c.is_ascii_digit())).collect();
                let (ta, tb) = (na.trim_start_matches('0'), nb.trim_start_matches('0'));
                let o = ta.len().cmp(&tb.len()).then_with(|| ta.cmp(tb));
                if o != Ordering::Equal {
                    return o;
                }
            }
            (Some(x), Some(y)) => {
                let o = x.to_lowercase().cmp(y.to_lowercase());
                if o != Ordering::Equal {
                    return o;
                }
                a.next();
                b.next();
            }
        }
    }
}

/// Name search across the project (tree filter). Case-insensitive substring; capped.
pub fn search(roots: &[PathBuf], query: &str, v: Visibility, limit: usize) -> Vec<Entry> {
    let q = query.to_lowercase();
    let mut out = Vec::new();
    for r in roots {
        walk_search(r, &q, v, 0, limit, &mut out);
    }
    out
}

fn walk_search(dir: &Path, q: &str, v: Visibility, depth: usize, limit: usize, out: &mut Vec<Entry>) {
    if depth > 16 || out.len() >= limit {
        return;
    }
    let Ok(entries) = list(dir, v) else { return };
    for e in entries {
        if out.len() >= limit {
            return;
        }
        if e.name.to_lowercase().contains(q) {
            out.push(e.clone());
        }
        if e.dir {
            walk_search(&e.path, q, v, depth + 1, limit, out);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn natural_order() {
        let mut v = vec!["r10", "R2", "r1", "a", "B"];
        v.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(v, ["a", "B", "r1", "R2", "r10"]);
    }

    #[test]
    fn hides_noise() {
        let v = Visibility::default();
        assert!(!visible(".git", true, Visibility { hidden: true, aux: true }));
        assert!(!visible("main.aux", false, v));
        assert!(!visible("main.synctex.gz", false, v));
        assert!(!visible(".latexmkrc", false, v));
        assert!(visible("main.tex", false, v));
        assert!(visible("main.log", false, Visibility { hidden: false, aux: true }));
    }

    #[test]
    fn lists_dirs_first() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("b.tex"), "x").unwrap();
        std::fs::write(d.path().join("b.aux"), "x").unwrap();
        std::fs::create_dir(d.path().join("z")).unwrap();
        let names: Vec<_> = list(d.path(), Visibility::default()).unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["z", "b.tex"]);
    }
}
