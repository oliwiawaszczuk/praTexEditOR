//! Atomic JSON files: write to `<name>.tmp`, fsync, rename. A crash mid-write leaves
//! either the old or the new file, never a truncated one.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::Serialize;

pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = sibling(path, "tmp");
    {
        let mut f = File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)
}

pub fn write_json<T: Serialize + ?Sized>(path: &Path, value: &T) -> io::Result<()> {
    let bytes = serde_json::to_vec_pretty(value).map_err(io::Error::other)?;
    write_atomic(path, &bytes)
}

/// Missing file → `T::default()`. A file that does not parse is moved aside to
/// `<name>.corrupt` (kept for inspection) and the default is returned — the app must
/// start even after a bad write by hand.
pub fn read_json<T: DeserializeOwned + Default>(path: &Path) -> T {
    let Ok(bytes) = fs::read(path) else {
        return T::default();
    };
    match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[pratex] {} is not valid JSON ({e}), moved aside", path.display());
            let _ = fs::rename(path, sibling(path, "corrupt"));
            T::default()
        }
    }
}

fn sibling(path: &Path, ext: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".");
    name.push(ext);
    path.with_file_name(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    #[test]
    fn roundtrip_and_no_tmp_left() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a/b/s.json");
        write_json(&p, &json!({"x": 1})).unwrap();
        let v: Value = read_json(&p);
        assert_eq!(v, json!({"x": 1}));
        assert!(!dir.path().join("a/b/s.json.tmp").exists());
    }

    #[test]
    fn missing_is_default() {
        let dir = tempfile::tempdir().unwrap();
        let v: Value = read_json(&dir.path().join("none.json"));
        assert_eq!(v, Value::Null);
    }

    #[test]
    fn corrupt_is_moved_aside() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("s.json");
        fs::write(&p, b"{not json").unwrap();
        let v: Value = read_json(&p);
        assert_eq!(v, Value::Null);
        assert!(!p.exists());
        assert!(dir.path().join("s.json.corrupt").exists());
    }
}
