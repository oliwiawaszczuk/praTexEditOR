//! Whiteboards (zakładka Tablica) — global, independent of projects, like Notatki:
//! `<app data>/boards/registry.json`, `<id>/board.json` (objects + viewport, opaque to
//! Rust) and `<id>/assets/<16 hex>.<ext>` (pasted, dropped or PDF-clip images). Assets
//! reach the webview through `pratex://…/board/<id>?f=<file>`, never through IPC.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use crate::core::jsonio::{read_json, write_json};
use crate::core::paths::Paths;
use crate::core::{err, CmdResult};
use crate::projects::registry::{new_id, now_ms};

const EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp"];
const MAX_ASSET: usize = 64 * 1024 * 1024;

#[derive(Default)]
pub struct BoardsLock(Mutex<()>);

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BoardMeta {
    pub id: String,
    pub name: String,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Serialize, Deserialize, Default)]
struct Registry {
    boards: Vec<BoardMeta>,
}

fn root(paths: &Paths) -> PathBuf {
    paths.data.join("boards")
}

fn valid_id(id: &str) -> CmdResult<()> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Niepoprawny identyfikator tablicy".into());
    }
    Ok(())
}

/// Asset file names are ours: 16 hex + a known image extension.
pub fn valid_asset(name: &str) -> bool {
    match name.rsplit_once('.') {
        Some((stem, ext)) => stem.len() == 16 && stem.chars().all(|c| c.is_ascii_hexdigit()) && EXTS.contains(&ext),
        None => false,
    }
}

pub fn asset_path(paths: &Paths, bid: &str, file: &str) -> Option<PathBuf> {
    (valid_id(bid).is_ok() && valid_asset(file)).then(|| root(paths).join(bid).join("assets").join(file))
}

fn registry(paths: &Paths) -> Registry {
    read_json(&root(paths).join("registry.json"))
}

fn save_registry(paths: &Paths, reg: &Registry) -> CmdResult<()> {
    write_json(&root(paths).join("registry.json"), reg).map_err(err)
}

fn exists(reg: &Registry, id: &str) -> CmdResult<()> {
    valid_id(id)?;
    reg.boards.iter().any(|b| b.id == id).then_some(()).ok_or_else(|| "Tablica nie istnieje".to_string())
}

#[tauri::command]
pub fn boards_list(paths: State<'_, Paths>) -> Vec<BoardMeta> {
    let mut b = registry(&paths).boards;
    b.sort_by_key(|x| x.created_at);
    b
}

#[tauri::command]
pub fn boards_create(paths: State<'_, Paths>, lock: State<'_, BoardsLock>, name: String) -> CmdResult<BoardMeta> {
    let _g = lock.0.lock().map_err(err)?;
    let mut reg = registry(&paths);
    let name = name.trim();
    let now = now_ms();
    let b = BoardMeta {
        id: new_id(),
        name: if name.is_empty() { "Nowa tablica".into() } else { name.chars().take(120).collect() },
        created_at: now,
        updated_at: now,
    };
    let dir = root(&paths).join(&b.id);
    std::fs::create_dir_all(dir.join("assets")).map_err(err)?;
    write_json(&dir.join("board.json"), &json!({"objects": [], "viewport": {"x": 0, "y": 0, "zoom": 1}})).map_err(err)?;
    reg.boards.push(b.clone());
    save_registry(&paths, &reg)?;
    Ok(b)
}

#[tauri::command]
pub fn boards_rename(paths: State<'_, Paths>, lock: State<'_, BoardsLock>, id: String, name: String) -> CmdResult<()> {
    let _g = lock.0.lock().map_err(err)?;
    let mut reg = registry(&paths);
    exists(&reg, &id)?;
    if let Some(b) = reg.boards.iter_mut().find(|b| b.id == id) {
        let n = name.trim();
        if !n.is_empty() {
            b.name = n.chars().take(120).collect();
        }
        b.updated_at = now_ms();
    }
    save_registry(&paths, &reg)
}

#[tauri::command]
pub fn boards_delete(paths: State<'_, Paths>, lock: State<'_, BoardsLock>, id: String) -> CmdResult<()> {
    let _g = lock.0.lock().map_err(err)?;
    let mut reg = registry(&paths);
    exists(&reg, &id)?;
    reg.boards.retain(|b| b.id != id);
    save_registry(&paths, &reg)?;
    let _ = std::fs::remove_dir_all(root(&paths).join(&id));
    Ok(())
}

#[tauri::command]
pub fn board_get(paths: State<'_, Paths>, id: String) -> CmdResult<Value> {
    exists(&registry(&paths), &id)?;
    let v: Value = read_json(&root(&paths).join(&id).join("board.json"));
    Ok(if v.is_object() { v } else { json!({"objects": [], "viewport": {"x": 0, "y": 0, "zoom": 1}}) })
}

#[tauri::command]
pub fn board_set(paths: State<'_, Paths>, lock: State<'_, BoardsLock>, id: String, data: Value) -> CmdResult<()> {
    let _g = lock.0.lock().map_err(err)?;
    let mut reg = registry(&paths);
    exists(&reg, &id)?;
    write_json(&root(&paths).join(&id).join("board.json"), &data).map_err(err)?;
    if let Some(b) = reg.boards.iter_mut().find(|b| b.id == id) {
        b.updated_at = now_ms();
    }
    save_registry(&paths, &reg)
}

fn store_asset(paths: &Paths, id: &str, bytes: &[u8], ext: &str) -> CmdResult<String> {
    let ext = ext.trim_start_matches('.').to_ascii_lowercase();
    if !EXTS.contains(&ext.as_str()) {
        return Err("Nieobsługiwany format obrazu".into());
    }
    if bytes.is_empty() || bytes.len() > MAX_ASSET {
        return Err("Pusty albo za duży obraz".into());
    }
    exists(&registry(paths), id)?;
    let name = format!("{:016x}.{ext}", (u128::from_str_radix(&new_id(), 16).unwrap_or(0) << 16 | (now_ms() as u128 & 0xffff)) & 0xffff_ffff_ffff_ffff);
    let dir = root(paths).join(id).join("assets");
    std::fs::create_dir_all(&dir).map_err(err)?;
    crate::core::jsonio::write_atomic(&dir.join(&name), bytes).map_err(err)?;
    Ok(name)
}

/// Raw image bytes in the request body; headers `id` and `ext`. Returns the asset file name.
#[tauri::command]
pub fn board_asset_add(paths: State<'_, Paths>, request: tauri::ipc::Request<'_>) -> CmdResult<String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Brak danych obrazu".into());
    };
    let header = |k: &str| -> CmdResult<String> { request.headers().get(k).and_then(|v| v.to_str().ok()).map(str::to_string).ok_or_else(|| "Brak nagłówka".to_string()) };
    store_asset(&paths, &header("id")?, bytes, &header("ext")?)
}

/// An image file from disk (dropped on the board) copied into the board's assets.
#[tauri::command]
pub fn board_asset_from_path(paths: State<'_, Paths>, id: String, path: PathBuf) -> CmdResult<String> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_string();
    let bytes = std::fs::read(&path).map_err(err)?;
    store_asset(&paths, &id, &bytes, &ext)
}

/// Board export: PNG bytes in the body, header `name` (percent-encoded); a save dialog
/// asks where. Returns the chosen path, null when cancelled.
#[tauri::command]
pub async fn board_export_png(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> CmdResult<Option<PathBuf>> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Brak danych obrazu".into());
    };
    let name = request.headers().get("name").and_then(|v| v.to_str().ok()).map(crate::protocol::decode).unwrap_or_else(|| "tablica.png".into());
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        let Some(dest) = app.dialog().file().add_filter("Obraz PNG", &["png"]).set_file_name(name).blocking_save_file() else {
            return Ok(None);
        };
        let dest = dest.into_path().map_err(err)?;
        std::fs::write(&dest, bytes).map_err(err)?;
        Ok(Some(dest))
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asset_names_are_validated() {
        assert!(valid_asset("0123456789abcdef.png"));
        assert!(!valid_asset("../0123456789abcdef.png"));
        assert!(!valid_asset("0123456789abcdef.svg"));
        assert!(!valid_asset("short.png"));
    }

    #[test]
    fn stores_and_resolves_an_asset() {
        let d = tempfile::tempdir().unwrap();
        let paths = Paths::at(d.path().to_path_buf(), d.path().join("c")).unwrap();
        let reg = Registry { boards: vec![BoardMeta { id: "abc123".into(), name: "t".into(), ..Default::default() }] };
        save_registry(&paths, &reg).unwrap();
        let name = store_asset(&paths, "abc123", b"png-bytes", "PNG").unwrap();
        assert!(valid_asset(&name), "{name}");
        assert!(asset_path(&paths, "abc123", &name).unwrap().is_file());
        assert!(store_asset(&paths, "abc123", b"x", "exe").is_err());
        assert!(store_asset(&paths, "nope00", b"x", "png").is_err());
    }
}
