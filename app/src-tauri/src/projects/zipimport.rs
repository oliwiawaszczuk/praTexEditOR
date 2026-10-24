//! Unpack a `.zip` (e.g. an Overleaf "Download source") into a new folder. Entries that
//! would escape the folder (`../`, absolute paths) are refused.

use std::io;
use std::path::Path;

pub fn extract(zip_path: &Path, dest: &Path) -> io::Result<usize> {
    let file = std::fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file).map_err(io::Error::other)?;
    // Overleaf zips are flat; others often wrap everything in one top folder → strip it.
    let names: Vec<String> = archive.file_names().filter_map(Result::ok).map(|n| n.into_owned()).collect();
    let prefix = common_top_folder(&names);
    let mut count = 0;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(io::Error::other)?;
        let Some(rel) = entry.enclosed_name() else {
            return Err(io::Error::other("Archiwum zawiera niebezpieczne ścieżki"));
        };
        let rel = match &prefix {
            Some(p) => match rel.strip_prefix(p) {
                Ok(r) => r.to_path_buf(),
                Err(_) => rel,
            },
            None => rel,
        };
        let name = rel.to_string_lossy();
        if rel.as_os_str().is_empty() || name.starts_with("__MACOSX") || name.ends_with(".DS_Store") {
            continue;
        }
        let out = dest.join(&rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out)?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut f = std::fs::File::create(&out)?;
        io::copy(&mut entry, &mut f)?;
        count += 1;
    }
    Ok(count)
}

fn common_top_folder(names: &[String]) -> Option<String> {
    let files: Vec<&String> = names.iter().filter(|n| !n.starts_with("__MACOSX")).collect();
    let first = files.first()?.split('/').next()?.to_string();
    let all_inside = files
        .iter()
        .all(|n| n.starts_with(&format!("{first}/")) || **n == format!("{first}/"));
    all_inside.then_some(first)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn make_zip(path: &Path, entries: &[(&str, &str)]) {
        let mut z = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (n, c) in entries {
            z.start_file(*n, opts).unwrap();
            z.write_all(c.as_bytes()).unwrap();
        }
        z.finish().unwrap();
    }

    #[test]
    fn strips_single_top_folder() {
        let d = tempfile::tempdir().unwrap();
        let zp = d.path().join("p.zip");
        make_zip(&zp, &[("proj/main.tex", "m"), ("proj/img/a.png", "a"), ("__MACOSX/x", "")]);
        let out = d.path().join("out");
        assert_eq!(extract(&zp, &out).unwrap(), 2);
        assert!(out.join("main.tex").exists() && out.join("img/a.png").exists());
    }

    #[test]
    fn flat_zip_kept() {
        let d = tempfile::tempdir().unwrap();
        let zp = d.path().join("p.zip");
        make_zip(&zp, &[("main.tex", "m"), ("bib.bib", "b")]);
        let out = d.path().join("out");
        extract(&zp, &out).unwrap();
        assert!(out.join("main.tex").exists());
    }
}
