//! File operations on project folders. Deleting = system trash (recoverable). Name
//! clashes never overwrite silently: the caller first gets the list of conflicts and
//! retries with a policy chosen by the user.

use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Policy {
    /// Any clash → do nothing, report the clashes.
    Ask,
    /// Existing target goes to the trash first.
    Replace,
    /// `name-2.ext`, `name-3.ext`…
    KeepBoth,
    Skip,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transfer {
    /// (from, to) for every item actually moved/copied — the inverse is the undo.
    pub done: Vec<(PathBuf, PathBuf)>,
    /// Sources whose name already exists in the target (policy Ask).
    pub conflicts: Vec<PathBuf>,
    pub skipped: Vec<PathBuf>,
}

pub fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = split_name(name);
    (2..)
        .map(|n| dir.join(format!("{stem}-{n}{ext}")))
        .find(|p| !p.exists())
        .unwrap()
}

/// "wykres.final.png" → ("wykres.final", ".png"); "main.synctex.gz" → ("main", ".synctex.gz");
/// ".latexmkrc" → (".latexmkrc", "").
fn split_name(name: &str) -> (&str, &str) {
    if let Some(stem) = name.strip_suffix(".synctex.gz") {
        return (stem, ".synctex.gz");
    }
    match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    }
}

pub fn create_file(dir: &Path, name: &str) -> io::Result<PathBuf> {
    let p = dir.join(name);
    std::fs::OpenOptions::new().write(true).create_new(true).open(&p)?;
    Ok(p)
}

pub fn create_dir(dir: &Path, name: &str) -> io::Result<PathBuf> {
    let p = dir.join(name);
    std::fs::create_dir(&p)?;
    Ok(p)
}

/// Rename in place. A case-only change ("Main.tex" → "main.tex") works on
/// case-insensitive file systems too (via a temporary name).
pub fn rename(path: &Path, new_name: &str) -> io::Result<PathBuf> {
    let parent = path.parent().ok_or_else(|| io::Error::other("brak folderu nadrzędnego"))?;
    let target = parent.join(new_name);
    let old_name = path.file_name().unwrap_or_default().to_string_lossy();
    if target == path {
        return Ok(target);
    }
    if old_name.to_lowercase() == new_name.to_lowercase() {
        let tmp = unique_path(parent, &format!(".{new_name}.renaming"));
        std::fs::rename(path, &tmp)?;
        std::fs::rename(&tmp, &target)?;
        return Ok(target);
    }
    if target.exists() {
        return Err(io::Error::new(io::ErrorKind::AlreadyExists, "Plik o tej nazwie już istnieje"));
    }
    std::fs::rename(path, &target)?;
    Ok(target)
}

/// Move or copy `sources` into `target_dir`.
pub fn transfer(sources: &[PathBuf], target_dir: &Path, copy: bool, policy: Policy) -> io::Result<Transfer> {
    let mut t = Transfer::default();
    if !target_dir.is_dir() {
        return Err(io::Error::other("Folder docelowy nie istnieje"));
    }
    for s in sources {
        if target_dir.starts_with(s) {
            return Err(io::Error::other("Nie można przenieść folderu do niego samego"));
        }
    }
    if policy == Policy::Ask {
        t.conflicts = sources
            .iter()
            .filter(|s| {
                let dest = target_dir.join(s.file_name().unwrap_or_default());
                dest.exists() && dest != **s
            })
            .cloned()
            .collect();
        if !t.conflicts.is_empty() {
            return Ok(t);
        }
    }
    for s in sources {
        let name = s.file_name().unwrap_or_default().to_string_lossy().to_string();
        let mut dest = target_dir.join(&name);
        if dest == *s {
            if !copy {
                continue; // dropped where it already is
            }
            dest = unique_path(target_dir, &name);
        } else if dest.exists() {
            match policy {
                Policy::Skip | Policy::Ask => {
                    t.skipped.push(s.clone());
                    continue;
                }
                Policy::KeepBoth => dest = unique_path(target_dir, &name),
                Policy::Replace => trash::delete(&dest).map_err(io::Error::other)?,
            }
        }
        if copy {
            copy_recursive(s, &dest)?;
        } else {
            move_path(s, &dest)?;
        }
        t.done.push((s.clone(), dest));
    }
    Ok(t)
}

fn move_path(from: &Path, to: &Path) -> io::Result<()> {
    match std::fs::rename(from, to) {
        Ok(()) => Ok(()),
        // Another volume (EXDEV / ERROR_NOT_SAME_DEVICE): copy, then remove the source.
        Err(e) if matches!(e.raw_os_error(), Some(18) | Some(17)) => {
            copy_recursive(from, to)?;
            if from.is_dir() {
                std::fs::remove_dir_all(from)
            } else {
                std::fs::remove_file(from)
            }
        }
        Err(e) => Err(e),
    }
}

pub fn copy_recursive(from: &Path, to: &Path) -> io::Result<()> {
    if from.is_dir() {
        std::fs::create_dir_all(to)?;
        for e in std::fs::read_dir(from)? {
            let e = e?;
            copy_recursive(&e.path(), &to.join(e.file_name()))?;
        }
        Ok(())
    } else {
        std::fs::copy(from, to).map(|_| ())
    }
}

pub fn duplicate(path: &Path) -> io::Result<PathBuf> {
    let dir = path.parent().ok_or_else(|| io::Error::other("brak folderu nadrzędnego"))?;
    let dest = unique_path(dir, &path.file_name().unwrap_or_default().to_string_lossy());
    copy_recursive(path, &dest)?;
    Ok(dest)
}

/// Show the item selected in Finder / Explorer / the file manager.
pub fn reveal(path: &Path) -> io::Result<()> {
    reveal_os(&path.canonicalize().unwrap_or_else(|_| path.to_path_buf()))
}

#[cfg(target_os = "macos")]
fn reveal_os(abs: &Path) -> io::Result<()> {
    std::process::Command::new("open").arg("-R").arg(abs).spawn().map(|_| ())
}

#[cfg(target_os = "windows")]
fn reveal_os(abs: &Path) -> io::Result<()> {
    use std::os::windows::process::CommandExt;
    // explorer rejects the `\\?\` form and wants the path quoted after the comma.
    let plain = abs.to_string_lossy().trim_start_matches(r"\\?\").to_string();
    std::process::Command::new("explorer").raw_arg(format!("/select,\"{plain}\"")).spawn().map(|_| ())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_os(abs: &Path) -> io::Result<()> {
    reveal_linux(abs)
}

/// `file://` URI with the characters a URI needs escaped.
#[cfg(unix)]
#[cfg_attr(target_os = "macos", allow(dead_code))]
fn file_uri(p: &Path) -> String {
    use std::os::unix::ffi::OsStrExt;
    let mut out = String::from("file://");
    for &b in p.as_os_str().as_bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'/' | b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Freedesktop `FileManager1.ShowItems` (Dolphin, Nautilus, Nemo… select the item); when no
/// file manager answers on D-Bus, open the containing folder with `xdg-open`.
#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_linux(abs: &Path) -> io::Result<()> {
    use crate::core::hostenv;
    use std::process::Stdio;
    let shown = hostenv::command("dbus-send")
        .args([
            "--session",
            "--type=method_call",
            "--dest=org.freedesktop.FileManager1",
            "/org/freedesktop/FileManager1",
            "org.freedesktop.FileManager1.ShowItems",
        ])
        .arg(format!("array:string:{}", file_uri(abs)))
        .arg("string:")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success());
    if shown {
        return Ok(());
    }
    let dir = if abs.is_dir() { abs } else { abs.parent().unwrap_or(abs) };
    let st = hostenv::command("xdg-open").arg(dir).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status().map_err(|e| {
        if e.kind() == io::ErrorKind::NotFound {
            io::Error::other("Brak programu xdg-open — zainstaluj pakiet xdg-utils")
        } else {
            e
        }
    })?;
    if st.success() {
        Ok(())
    } else {
        Err(io::Error::other("Menedżer plików nie otworzył folderu (xdg-open zwrócił błąd)"))
    }
}

/// Open a file or http(s)/mailto link in its default app (PDF → Preview).
pub fn open_default(path: &Path) -> io::Result<()> {
    open_os(path)
}

#[cfg(target_os = "macos")]
fn open_os(path: &Path) -> io::Result<()> {
    std::process::Command::new("open").arg(path).spawn().map(|_| ())
}

#[cfg(target_os = "windows")]
fn open_os(path: &Path) -> io::Result<()> {
    use std::os::windows::process::CommandExt;
    // No `cmd /C start`: cmd would read `&` in a file name as a second command.
    std::process::Command::new("rundll32").arg("url.dll,FileProtocolHandler").arg(path).creation_flags(0x0800_0000).spawn().map(|_| ())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_os(path: &Path) -> io::Result<()> {
    use std::process::Stdio;
    crate::core::hostenv::command("xdg-open")
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| {
            if e.kind() == io::ErrorKind::NotFound {
                io::Error::other("Brak programu xdg-open — zainstaluj pakiet xdg-utils")
            } else {
                e
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(p: &Path, s: &str) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, s).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn file_uri_escapes_what_a_uri_needs() {
        assert_eq!(file_uri(Path::new("/home/ola/Moja praca/rozdział.tex")), "file:///home/ola/Moja%20praca/rozdzia%C5%82.tex");
    }

    #[test]
    fn unique_names() {
        let d = tempfile::tempdir().unwrap();
        touch(&d.path().join("a.png"), "");
        touch(&d.path().join("a-2.png"), "");
        assert_eq!(unique_path(d.path(), "a.png"), d.path().join("a-3.png"));
        assert_eq!(unique_path(d.path(), "b.png"), d.path().join("b.png"));
        assert_eq!(split_name(".latexmkrc"), (".latexmkrc", ""));
    }

    #[test]
    fn move_with_conflicts() {
        let d = tempfile::tempdir().unwrap();
        let (src, dst) = (d.path().join("src"), d.path().join("dst"));
        touch(&src.join("a.tex"), "new");
        touch(&src.join("b.tex"), "b");
        touch(&dst.join("a.tex"), "old");
        let srcs = vec![src.join("a.tex"), src.join("b.tex")];

        let t = transfer(&srcs, &dst, false, Policy::Ask).unwrap();
        assert_eq!(t.conflicts, vec![src.join("a.tex")]);
        assert!(t.done.is_empty() && src.join("b.tex").exists(), "Ask must not touch anything");

        let t = transfer(&srcs, &dst, false, Policy::KeepBoth).unwrap();
        assert_eq!(t.done.len(), 2);
        assert_eq!(std::fs::read_to_string(dst.join("a-2.tex")).unwrap(), "new");
        assert_eq!(std::fs::read_to_string(dst.join("a.tex")).unwrap(), "old");
        assert!(dst.join("b.tex").exists() && !src.join("b.tex").exists());
    }

    #[test]
    fn copy_folder_and_refuse_into_itself() {
        let d = tempfile::tempdir().unwrap();
        touch(&d.path().join("f/x/y.tex"), "y");
        let t = transfer(&[d.path().join("f")], &d.path().join("g"), true, Policy::Ask);
        assert!(t.is_err(), "g does not exist yet → error from copy");
        std::fs::create_dir(d.path().join("g")).unwrap();
        transfer(&[d.path().join("f")], &d.path().join("g"), true, Policy::Ask).unwrap();
        assert!(d.path().join("g/f/x/y.tex").exists() && d.path().join("f/x/y.tex").exists());
        assert!(transfer(&[d.path().join("f")], &d.path().join("f/x"), false, Policy::Ask).is_err());
    }

    #[test]
    fn rename_rules() {
        let d = tempfile::tempdir().unwrap();
        touch(&d.path().join("Main.tex"), "m");
        touch(&d.path().join("b.tex"), "b");
        let p = rename(&d.path().join("Main.tex"), "main.tex").unwrap();
        assert_eq!(p.file_name().unwrap(), "main.tex");
        assert!(std::fs::read_dir(d.path()).unwrap().any(|e| e.unwrap().file_name() == "main.tex"));
        assert!(rename(&d.path().join("b.tex"), "main.tex").is_err());
    }
}
