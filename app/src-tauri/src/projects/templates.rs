//! Project templates: built-in (repo `templates/`, embedded at compile time) and the
//! user's own ("Zapisz projekt jako szablon"): `<app data>/templates/<id>/` holds
//! `template.json` {name, main} and the project's files under `files/`.

use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::core::jsonio::{read_json, write_json};
use crate::core::paths::Paths;
use crate::core::{err, CmdResult};
use crate::fs::guard;
use crate::fs::tree::{is_aux_file, is_ignored_dir};
use crate::projects::registry::{new_id, Projects};

macro_rules! tpl {
    ($p:literal) => {
        include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../templates/", $p))
    };
}

/// Shared preamble, substituted for `%%PREAMBLE%%` in every `main.tex`.
pub const PREAMBLE: &str = tpl!("preamble.tex");

pub struct Template {
    pub id: &'static str,
    pub name: &'static str,
    pub icon: &'static str,
    /// (relative path, content); a path ending in `/` is an empty folder.
    pub files: &'static [(&'static str, &'static str)],
}

pub const TEMPLATES: &[Template] = &[
    Template {
        id: "pusty",
        name: "Pusty",
        icon: "file",
        files: &[("main.tex", tpl!("pusty/main.tex"))],
    },
    Template {
        id: "raport",
        name: "Raport",
        icon: "report",
        files: &[
            ("main.tex", tpl!("raport/main.tex")),
            ("bibliografia.bib", tpl!("raport/bibliografia.bib")),
            ("img/", ""),
        ],
    },
    Template {
        id: "artykul",
        name: "Artykuł",
        icon: "article",
        files: &[("main.tex", tpl!("artykul/main.tex")), ("img/", "")],
    },
    Template {
        id: "praca",
        name: "Praca dyplomowa",
        icon: "thesis",
        files: &[
            ("main.tex", tpl!("praca/main.tex")),
            ("rozdzialy/01-wstep.tex", tpl!("praca/rozdzialy/01-wstep.tex")),
            ("rozdzialy/02-metody.tex", tpl!("praca/rozdzialy/02-metody.tex")),
            ("bibliografia.bib", tpl!("praca/bibliografia.bib")),
            ("img/", ""),
        ],
    },
    Template {
        id: "prezentacja",
        name: "Prezentacja",
        icon: "slides",
        files: &[("main.tex", tpl!("prezentacja/main.tex"))],
    },
];

#[derive(Serialize)]
pub struct TemplateInfo {
    id: String,
    name: String,
    icon: String,
    files: Vec<String>,
    /// The user's own (can be edited and deleted).
    custom: bool,
    /// Main file, relative to the template.
    main: String,
}

#[derive(Serialize, Deserialize, Default)]
struct Meta {
    name: String,
    /// Main file relative to `files/`.
    main: String,
}

const USER_PREFIX: &str = "u-";
const MAX_FILES: usize = 5_000;
const MAX_BYTES: u64 = 200 * 1024 * 1024;

fn user_dir(paths: &Paths) -> PathBuf {
    paths.data.join("templates")
}

/// A user template's folder; the id is ours (`u-` + hex), nothing else reaches the disk.
fn user_template(paths: &Paths, id: &str) -> Option<PathBuf> {
    let hex = id.strip_prefix(USER_PREFIX)?;
    (!hex.is_empty() && hex.chars().all(|c| c.is_ascii_hexdigit())).then(|| user_dir(paths).join(hex))
}

/// Relative file paths under `dir` (no ignored folders, TeX by-products or symlinks).
fn walk(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_symlink() || name == ".DS_Store" {
                continue;
            }
            if ft.is_dir() {
                if !is_ignored_dir(&name) {
                    stack.push(e.path());
                }
            } else if !is_aux_file(&name) && !name.ends_with(".pratex~") {
                if let Ok(rel) = e.path().strip_prefix(dir) {
                    out.push(rel.to_path_buf());
                }
            }
        }
    }
    out.sort();
    out
}

/// Folders under `dir` (relative); `only_empty` = just the leaves that hold nothing, which
/// the file walk cannot see (they would be lost when a template is copied).
fn walk_dirs(dir: &Path, only_empty: bool) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        let mut empty = true;
        for e in rd.flatten() {
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_symlink() {
                continue;
            }
            empty = false;
            if ft.is_dir() && !is_ignored_dir(&e.file_name().to_string_lossy()) {
                stack.push(e.path());
            }
        }
        if d != dir && (!only_empty || empty) {
            if let Ok(rel) = d.strip_prefix(dir) {
                out.push(rel.to_path_buf());
            }
        }
    }
    out.sort();
    out
}

#[tauri::command]
pub fn templates_list(paths: State<'_, Paths>) -> Vec<TemplateInfo> {
    let mut out: Vec<TemplateInfo> = TEMPLATES
        .iter()
        .map(|t| TemplateInfo {
            id: t.id.into(),
            name: t.name.into(),
            icon: t.icon.into(),
            files: t.files.iter().map(|f| f.0.to_string()).filter(|p| !p.ends_with('/')).collect(),
            custom: false,
            main: "main.tex".into(),
        })
        .collect();
    let mut own = Vec::new();
    if let Ok(rd) = std::fs::read_dir(user_dir(&paths)) {
        for e in rd.flatten() {
            let meta: Meta = read_json(&e.path().join("template.json"));
            let Some(hex) = e.file_name().to_str().map(str::to_string) else { continue };
            if meta.name.is_empty() {
                continue;
            }
            let files = walk(&e.path().join("files")).iter().map(|p| p.to_string_lossy().into_owned()).take(12).collect();
            let main = if meta.main.is_empty() { "main.tex".into() } else { meta.main };
            own.push((meta.name.to_lowercase(), TemplateInfo { id: format!("{USER_PREFIX}{hex}"), name: meta.name, icon: "folder".into(), files, custom: true, main }));
        }
    }
    own.sort_by(|a, b| a.0.cmp(&b.0));
    out.extend(own.into_iter().map(|(_, t)| t));
    out
}

// ── Settings › Szablony: browse and edit ────────────────────────────────────

/// A relative path made of plain names only (no `..`, no absolute path).
fn clean_rel(rel: &str) -> CmdResult<PathBuf> {
    let p = PathBuf::from(rel.trim());
    let ok = !rel.trim().is_empty() && p.components().all(|c| matches!(c, std::path::Component::Normal(_)));
    if !ok {
        return Err("Niepoprawna ścieżka pliku w szablonie".into());
    }
    Ok(p)
}

fn custom_dir(paths: &Paths, id: &str) -> CmdResult<PathBuf> {
    user_template(paths, id).filter(|d| d.is_dir()).ok_or_else(|| "Nie ma takiego szablonu (wbudowanych nie da się zmieniać)".to_string())
}

#[derive(Serialize)]
pub struct TemplateFile {
    path: String,
    size: u64,
    dir: bool,
}

#[tauri::command]
pub fn template_files(paths: State<'_, Paths>, id: String) -> CmdResult<Vec<TemplateFile>> {
    if let Some(t) = find(&id) {
        return Ok(t
            .files
            .iter()
            .map(|f| match f.0.strip_suffix('/') {
                Some(d) => TemplateFile { path: d.into(), size: 0, dir: true },
                None => TemplateFile { path: f.0.into(), size: f.1.len() as u64, dir: false },
            })
            .collect());
    }
    let files = custom_dir(&paths, &id)?.join("files");
    let mut out: Vec<TemplateFile> = walk_dirs(&files, false).into_iter().map(|p| TemplateFile { path: p.to_string_lossy().into_owned(), size: 0, dir: true }).collect();
    out.extend(walk(&files).into_iter().map(|p| TemplateFile { size: std::fs::metadata(files.join(&p)).map(|m| m.len()).unwrap_or(0), path: p.to_string_lossy().into_owned(), dir: false }));
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// Text of one template file (built-ins with the shared preamble already in place).
#[tauri::command]
pub fn template_read(paths: State<'_, Paths>, id: String, path: String) -> CmdResult<String> {
    if let Some(t) = find(&id) {
        let (_, c) = t.files.iter().find(|f| f.0 == path).ok_or("Nie ma takiego pliku")?;
        return Ok(c.replace("%%PREAMBLE%%", PREAMBLE.trim_end()));
    }
    let f = custom_dir(&paths, &id)?.join("files").join(clean_rel(&path)?);
    let bytes = std::fs::read(&f).map_err(|_| "Nie ma takiego pliku".to_string())?;
    String::from_utf8(bytes).map_err(|_| "To nie jest plik tekstowy (UTF-8)".to_string())
}

/// Creates or overwrites a text file of a custom template.
#[tauri::command]
pub fn template_write(paths: State<'_, Paths>, id: String, path: String, text: String) -> CmdResult<()> {
    let f = custom_dir(&paths, &id)?.join("files").join(clean_rel(&path)?);
    crate::core::jsonio::write_atomic(&f, text.as_bytes()).map_err(err)
}

#[tauri::command]
pub fn template_remove_file(paths: State<'_, Paths>, id: String, path: String) -> CmdResult<()> {
    let f = custom_dir(&paths, &id)?.join("files").join(clean_rel(&path)?);
    if f.is_dir() {
        std::fs::remove_dir_all(f).map_err(err)?;
    } else if f.is_file() {
        std::fs::remove_file(f).map_err(err)?;
    }
    Ok(())
}

/// A (possibly empty) folder inside a custom template.
#[tauri::command]
pub fn template_add_dir(paths: State<'_, Paths>, id: String, path: String) -> CmdResult<()> {
    let f = custom_dir(&paths, &id)?.join("files").join(clean_rel(&path)?);
    std::fs::create_dir_all(f).map_err(err)
}

#[tauri::command]
pub fn template_rename(paths: State<'_, Paths>, id: String, name: String) -> CmdResult<()> {
    let dir = custom_dir(&paths, &id)?;
    let name = guard::valid_name(&name)?.to_string();
    let mut meta: Meta = read_json(&dir.join("template.json"));
    meta.name = name;
    write_json(&dir.join("template.json"), &meta).map_err(err)
}

#[tauri::command]
pub fn template_set_main(paths: State<'_, Paths>, id: String, path: String) -> CmdResult<()> {
    let dir = custom_dir(&paths, &id)?;
    let rel = clean_rel(&path)?;
    if !dir.join("files").join(&rel).is_file() {
        return Err("Nie ma takiego pliku".into());
    }
    let mut meta: Meta = read_json(&dir.join("template.json"));
    meta.main = rel.to_string_lossy().into_owned();
    write_json(&dir.join("template.json"), &meta).map_err(err)
}

/// A new custom template: a copy of `from` (built-in or own; default "pusty").
#[tauri::command]
pub fn template_create(paths: State<'_, Paths>, name: String, from: Option<String>) -> CmdResult<String> {
    let name = guard::valid_name(&name)?.to_string();
    let from = from.unwrap_or_else(|| "pusty".into());
    let hex = new_id();
    let dir = user_dir(&paths).join(&hex);
    let files = dir.join("files");
    std::fs::create_dir_all(&files).map_err(err)?;
    let res: CmdResult<String> = (|| {
        if let Some(t) = find(&from) {
            write(t, &files).map_err(err)?;
            Ok("main.tex".to_string())
        } else {
            write_user(&paths, &from, &files)
        }
    })();
    match res {
        Ok(main) => {
            write_json(&dir.join("template.json"), &Meta { name, main }).map_err(err)?;
            Ok(format!("{USER_PREFIX}{hex}"))
        }
        Err(e) => {
            let _ = std::fs::remove_dir_all(&dir);
            Err(e)
        }
    }
}

/// The project's files (the folder with the main file) become a template.
#[tauri::command]
pub fn template_save(reg: State<'_, Projects>, paths: State<'_, Paths>, pid: String, name: String) -> CmdResult<String> {
    let project = reg.get(&pid)?;
    let name = guard::valid_name(&name)?.to_string();
    let root = project
        .main
        .as_ref()
        .and_then(|m| project.roots.iter().find(|r| m.starts_with(r)))
        .or(project.roots.first())
        .ok_or("Projekt nie ma folderu")?
        .clone();
    let files = walk(&root);
    if files.is_empty() {
        return Err("Projekt jest pusty".into());
    }
    let mut total = 0u64;
    for f in &files {
        total += std::fs::metadata(root.join(f)).map(|m| m.len()).unwrap_or(0);
    }
    if files.len() > MAX_FILES || total > MAX_BYTES {
        return Err("Projekt jest za duży na szablon (limit 5000 plików / 200 MB)".into());
    }
    let hex = new_id();
    let dir = user_dir(&paths).join(&hex);
    let target = dir.join("files");
    let res: io::Result<()> = (|| {
        for d in walk_dirs(&root, true) {
            std::fs::create_dir_all(target.join(d))?;
        }
        for f in &files {
            let to = target.join(f);
            if let Some(parent) = to.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(root.join(f), to)?;
        }
        let main = project.main.as_ref().and_then(|m| m.strip_prefix(&root).ok()).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        write_json(&dir.join("template.json"), &Meta { name, main })
    })();
    if let Err(e) = res {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(err(e));
    }
    Ok(format!("{USER_PREFIX}{hex}"))
}

#[tauri::command]
pub fn template_delete(paths: State<'_, Paths>, id: String) -> CmdResult<()> {
    let dir = user_template(&paths, &id).ok_or("Nie ma takiego szablonu")?;
    if dir.is_dir() {
        std::fs::remove_dir_all(dir).map_err(err)?;
    }
    Ok(())
}

/// Copy a user template into an existing, empty folder; returns its main file (relative).
pub fn write_user(paths: &Paths, id: &str, dir: &Path) -> CmdResult<String> {
    let src = user_template(paths, id).ok_or("Nie ma takiego szablonu")?;
    let meta: Meta = read_json(&src.join("template.json"));
    let files = src.join("files");
    for d in walk_dirs(&files, true) {
        std::fs::create_dir_all(dir.join(d)).map_err(err)?;
    }
    for rel in walk(&files) {
        let to = dir.join(&rel);
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent).map_err(err)?;
        }
        std::fs::copy(files.join(&rel), to).map_err(err)?;
    }
    Ok(if meta.main.is_empty() { "main.tex".into() } else { meta.main })
}

pub fn find(id: &str) -> Option<&'static Template> {
    TEMPLATES.iter().find(|t| t.id == id)
}

/// Write a template into an existing, empty folder.
pub fn write(t: &Template, dir: &Path) -> io::Result<()> {
    for (rel, content) in t.files {
        let p = dir.join(rel);
        if rel.ends_with('/') {
            std::fs::create_dir_all(&p)?;
            continue;
        }
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&p, content.replace("%%PREAMBLE%%", PREAMBLE.trim_end()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_template_roundtrip_skips_aux_files() {
        let data = tempfile::tempdir().unwrap();
        let paths = Paths::at(data.path().to_path_buf(), data.path().join("cache")).unwrap();
        let hex = "abc123";
        let files = user_dir(&paths).join(hex).join("files");
        std::fs::create_dir_all(files.join("rozdzialy")).unwrap();
        std::fs::write(files.join("glowny.tex"), "x").unwrap();
        std::fs::write(files.join("rozdzialy/a.tex"), "y").unwrap();
        std::fs::write(files.join("glowny.aux"), "junk").unwrap();
        write_json(&user_dir(&paths).join(hex).join("template.json"), &Meta { name: "Moj".into(), main: "glowny.tex".into() }).unwrap();
        let out = tempfile::tempdir().unwrap();
        assert_eq!(write_user(&paths, "u-abc123", out.path()).unwrap(), "glowny.tex");
        assert!(out.path().join("rozdzialy/a.tex").is_file());
        assert!(!out.path().join("glowny.aux").exists());
        assert!(write_user(&paths, "u-../x", out.path()).is_err());
    }

    #[test]
    fn empty_folders_survive_a_copy() {
        let data = tempfile::tempdir().unwrap();
        let paths = Paths::at(data.path().to_path_buf(), data.path().join("cache")).unwrap();
        let files = user_dir(&paths).join("abc1").join("files");
        std::fs::create_dir_all(files.join("img")).unwrap();
        std::fs::write(files.join("main.tex"), "x").unwrap();
        write_json(&user_dir(&paths).join("abc1").join("template.json"), &Meta { name: "T".into(), main: "main.tex".into() }).unwrap();
        assert_eq!(walk_dirs(&files, true), vec![PathBuf::from("img")]);
        let out = tempfile::tempdir().unwrap();
        write_user(&paths, "u-abc1", out.path()).unwrap();
        assert!(out.path().join("img").is_dir());
    }

    #[test]
    fn rel_paths_reject_escapes() {
        assert!(clean_rel("rozdzialy/a.tex").is_ok());
        assert!(clean_rel("../x").is_err());
        assert!(clean_rel("/etc/passwd").is_err());
        assert!(clean_rel("  ").is_err());
    }

    #[test]
    fn every_template_writes_a_detectable_main() {
        for t in TEMPLATES {
            let d = tempfile::tempdir().unwrap();
            write(t, d.path()).unwrap();
            let main = std::fs::read_to_string(d.path().join("main.tex")).unwrap();
            assert!(!main.contains("%%PREAMBLE%%"), "{}", t.id);
            assert!(main.contains("\\usepackage[polish]{babel}"), "{}", t.id);
            let found = crate::projects::detect::find_mains(d.path());
            assert_eq!(found.first().map(|c| c.rel.as_str()), Some("main.tex"), "{}", t.id);
        }
    }
}
