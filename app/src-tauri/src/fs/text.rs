//! Text files for the editor. Reading normalises line endings to `\n` and strips a BOM
//! (both are remembered and restored on save, so a Windows file stays CRLF). Saving is
//! atomic in the file's own folder: hidden temp file → rename, permissions kept.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

/// Larger files open as a placeholder (a TeX source this big is generated data).
pub const MAX_TEXT: u64 = 16 * 1024 * 1024;

#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Read {
    #[serde(rename_all = "camelCase")]
    Text {
        text: String,
        crlf: bool,
        bom: bool,
        stamp: Stamp,
    },
    /// Same stamp as the caller already has: the file was not touched.
    Unchanged,
    Binary { size: u64 },
    TooBig { size: u64 },
    /// Text, but not UTF-8 (e.g. an old latin2 file) — never decode it lossily, a save
    /// would destroy every Polish letter.
    Encoding { size: u64 },
    Missing,
}

/// What identifies one version of a file on disk: our own save echoed back by the
/// watcher has the stamp we got from `write`, so the editor does not re-read it.
#[derive(Debug, Clone, Copy, Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Stamp {
    pub mtime: u64,
    pub size: u64,
}

fn stamp_of(meta: &fs::Metadata) -> Stamp {
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Stamp { mtime, size: meta.len() }
}

pub fn read(path: &Path, known: Option<Stamp>) -> io::Result<Read> {
    let meta = match fs::metadata(path) {
        Ok(m) if m.is_file() => m,
        Ok(_) => return Err(io::Error::other("To nie jest plik")),
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Read::Missing),
        Err(e) => return Err(e),
    };
    let stamp = stamp_of(&meta);
    if known == Some(stamp) {
        return Ok(Read::Unchanged);
    }
    if stamp.size > MAX_TEXT {
        return Ok(Read::TooBig { size: stamp.size });
    }
    let bytes = fs::read(path)?;
    let size = bytes.len() as u64;
    if bytes[..bytes.len().min(8192)].contains(&0) {
        return Ok(Read::Binary { size });
    }
    let (body, bom) = match bytes.strip_prefix(b"\xEF\xBB\xBF") {
        Some(rest) => (rest, true),
        None => (&bytes[..], false),
    };
    let Ok(s) = std::str::from_utf8(body) else {
        return Ok(Read::Encoding { size });
    };
    let crlf = s.find('\n').is_some_and(|i| i > 0 && s.as_bytes()[i - 1] == b'\r');
    let text = if s.contains('\r') { s.replace("\r\n", "\n").replace('\r', "\n") } else { s.to_string() };
    Ok(Read::Text { text, crlf, bom, stamp })
}

fn temp_sibling(path: &Path) -> io::Result<PathBuf> {
    let dir = path.parent().ok_or_else(|| io::Error::other("brak folderu nadrzędnego"))?;
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    Ok(dir.join(format!(".{name}.pratex~")))
}

/// Atomic save. `text` uses `\n`; `crlf`/`bom` restore what the file had.
pub fn write(path: &Path, text: &str, crlf: bool, bom: bool) -> io::Result<Stamp> {
    let tmp = temp_sibling(path)?;
    let perms = fs::metadata(path).ok().map(|m| m.permissions());
    let res = (|| {
        let mut f = fs::File::create(&tmp)?;
        if bom {
            f.write_all(b"\xEF\xBB\xBF")?;
        }
        if crlf {
            f.write_all(text.replace('\n', "\r\n").as_bytes())?;
        } else {
            f.write_all(text.as_bytes())?;
        }
        f.sync_all()?;
        drop(f);
        if let Some(p) = perms {
            fs::set_permissions(&tmp, p)?;
        }
        fs::rename(&tmp, path)
    })();
    if let Err(e) = res {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(stamp_of(&fs::metadata(path)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(r: Read) -> (String, bool, bool) {
        match r {
            Read::Text { text, crlf, bom, .. } => (text, crlf, bom),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn roundtrip_keeps_crlf_and_bom() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.tex");
        fs::write(&p, b"\xEF\xBB\xBFza\xC5\xBC\xC3\xB3\xC5\x82\xC4\x87\r\n\\section{x}\r\n").unwrap();
        let (t, crlf, bom) = text(read(&p, None).unwrap());
        assert_eq!(t, "zażółć\n\\section{x}\n");
        assert!(crlf && bom);
        write(&p, &(t + "nowa\n"), crlf, bom).unwrap();
        assert_eq!(fs::read(&p).unwrap(), "\u{feff}zażółć\r\n\\section{x}\r\nnowa\r\n".as_bytes());
        assert!(!d.path().join(".a.tex.pratex~").exists());
    }

    #[test]
    fn stamps_and_kinds() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.tex");
        let s = write(&p, "x\n", false, false).unwrap();
        assert_eq!(read(&p, Some(s)).unwrap(), Read::Unchanged);
        assert!(matches!(read(&p, None).unwrap(), Read::Text { crlf: false, bom: false, .. }));
        assert_eq!(read(&d.path().join("none.tex"), None).unwrap(), Read::Missing);
        fs::write(d.path().join("b.png"), b"\x89PNG\0\0").unwrap();
        assert!(matches!(read(&d.path().join("b.png"), None).unwrap(), Read::Binary { .. }));
        fs::write(d.path().join("c.tex"), b"za\xbf\xf3\xb3\xe6").unwrap(); // latin2
        assert!(matches!(read(&d.path().join("c.tex"), None).unwrap(), Read::Encoding { .. }));
    }

    #[cfg(unix)]
    #[test]
    fn permissions_survive_save() {
        use std::os::unix::fs::PermissionsExt;
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("run.sh");
        fs::write(&p, "a").unwrap();
        fs::set_permissions(&p, fs::Permissions::from_mode(0o755)).unwrap();
        write(&p, "b", false, false).unwrap();
        assert_eq!(fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o755);
    }
}
