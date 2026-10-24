//! Notes (docs/03-ux.md §9): global, independent of projects. One Markdown file per note,
//! `<app data>/notes/<id>.md`; the title is the first non-empty line, so there is no
//! separate index to keep in sync. Written atomically.

use std::path::PathBuf;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::State;

use crate::core::jsonio::write_atomic;
use crate::core::paths::Paths;
use crate::core::{err, CmdResult};
use crate::projects::registry::new_id;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
    pub id: String,
    pub title: String,
    pub preview: String,
    /// ms since the epoch.
    pub updated_at: u64,
}

fn dir(paths: &Paths) -> PathBuf {
    paths.data.join("notes")
}

/// Ids are ours (hex); anything else never touches the disk.
fn file(paths: &Paths, id: &str) -> CmdResult<PathBuf> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Niepoprawny identyfikator notatki".into());
    }
    Ok(dir(paths).join(format!("{id}.md")))
}

fn title_of(text: &str) -> String {
    let line = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    let t = line.trim_start_matches('#').trim();
    t.chars().take(80).collect()
}

fn meta(id: &str, text: &str, updated_at: u64) -> NoteMeta {
    NoteMeta { id: id.to_string(), title: title_of(text), preview: text.trim().chars().take(300).collect(), updated_at }
}

fn mtime_ms(p: &std::path::Path) -> u64 {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64)
}

#[tauri::command]
pub fn notes_list(paths: State<'_, Paths>) -> Vec<NoteMeta> {
    let Ok(rd) = std::fs::read_dir(dir(&paths)) else { return Vec::new() };
    let mut out: Vec<NoteMeta> = rd
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            let id = p.file_stem()?.to_str()?.to_string();
            (p.extension()? == "md").then(|| meta(&id, &std::fs::read_to_string(&p).unwrap_or_default(), mtime_ms(&p)))
        })
        .collect();
    out.sort_by_key(|n| std::cmp::Reverse(n.updated_at));
    out
}

#[tauri::command]
pub fn notes_create(paths: State<'_, Paths>, text: Option<String>) -> CmdResult<NoteMeta> {
    let id = new_id();
    let text = text.unwrap_or_default();
    let p = file(&paths, &id)?;
    write_atomic(&p, text.as_bytes()).map_err(err)?;
    Ok(meta(&id, &text, mtime_ms(&p)))
}

#[tauri::command]
pub fn notes_get(paths: State<'_, Paths>, id: String) -> CmdResult<String> {
    std::fs::read_to_string(file(&paths, &id)?).map_err(|_| "Nie ma takiej notatki".to_string())
}

/// Saves the text; returns the (possibly new) title. A note that vanished is not recreated.
#[tauri::command]
pub fn notes_set(paths: State<'_, Paths>, id: String, text: String) -> CmdResult<String> {
    let p = file(&paths, &id)?;
    if !p.is_file() {
        return Err("Nie ma takiej notatki".into());
    }
    write_atomic(&p, text.as_bytes()).map_err(err)?;
    Ok(title_of(&text))
}

/// Appends a block (a quoted fragment with its source) to the end of a note; returns the new text.
#[tauri::command]
pub fn notes_append(paths: State<'_, Paths>, id: String, block: String) -> CmdResult<String> {
    let p = file(&paths, &id)?;
    let mut text = std::fs::read_to_string(&p).map_err(|_| "Nie ma takiej notatki".to_string())?;
    if !text.is_empty() && !text.ends_with("\n\n") {
        text.push_str(if text.ends_with('\n') { "\n" } else { "\n\n" });
    }
    text.push_str(&block);
    text.push('\n');
    write_atomic(&p, text.as_bytes()).map_err(err)?;
    Ok(text)
}

#[tauri::command]
pub fn notes_delete(paths: State<'_, Paths>, id: String) -> CmdResult<()> {
    let p = file(&paths, &id)?;
    // To the system trash like every other deletion in the app.
    if p.is_file() {
        trash::delete(&p).map_err(err)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_is_first_non_empty_line_without_heading_marks() {
        assert_eq!(title_of("\n\n## Plan pracy\nreszta"), "Plan pracy");
        assert_eq!(title_of("   "), "");
    }

    #[test]
    fn ids_must_be_hex() {
        let paths = Paths { data: PathBuf::from("/d"), cache: PathBuf::from("/c") };
        assert!(file(&paths, "../x").is_err());
        assert!(file(&paths, "ab12").is_ok());
    }
}
