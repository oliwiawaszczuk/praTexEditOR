//! Every file operation is confined to the open project's folders, and every new name
//! is validated — a bug in the UI must never be able to touch anything else.

use std::path::{Component, Path, PathBuf};

use crate::projects::registry::Project;

/// Canonical form of `p`, also when `p` does not exist yet (canonical parent + name).
pub fn canonical(p: &Path) -> Result<PathBuf, String> {
    if let Ok(c) = p.canonicalize() {
        return Ok(c);
    }
    let parent = p.parent().ok_or("Niepoprawna ścieżka")?;
    let name = p.file_name().ok_or("Niepoprawna ścieżka")?;
    Ok(canonical(parent)?.join(name))
}

pub fn inside(project: &Project, p: &Path) -> Result<PathBuf, String> {
    if p.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("Niepoprawna ścieżka".into());
    }
    let c = canonical(p)?;
    if project.roots.iter().any(|r| c.starts_with(r)) {
        Ok(c)
    } else {
        Err("Ścieżka jest poza folderami projektu".into())
    }
}

pub fn is_root(project: &Project, p: &Path) -> bool {
    project.roots.iter().any(|r| r == p)
}

pub fn valid_name(name: &str) -> Result<&str, String> {
    let n = name.trim();
    let bad = n.is_empty()
        || n == "."
        || n == ".."
        || n.len() > 255
        || n.chars().any(|c| matches!(c, '/' | '\\' | '\0' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control());
    if bad {
        Err("Niedozwolona nazwa".into())
    } else {
        Ok(n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert!(valid_name("rozdział 1.tex").is_ok());
        for n in ["", " ", "..", "a/b", "a\\b", "a:b", "x?"] {
            assert!(valid_name(n).is_err(), "{n:?}");
        }
    }

    #[test]
    fn confinement() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("root");
        std::fs::create_dir_all(root.join("sub")).unwrap();
        let p = Project {
            id: "x".into(),
            name: "x".into(),
            color: String::new(),
            roots: vec![root.canonicalize().unwrap()],
            main: None,
            created_at: 0,
            opened_at: 0,
        };
        assert!(inside(&p, &root.join("sub/new.tex")).is_ok());
        assert!(inside(&p, &d.path().join("other.tex")).is_err());
        assert!(inside(&p, &root.join("sub/../../other.tex")).is_err());
    }
}
