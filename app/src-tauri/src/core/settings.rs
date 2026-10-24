//! Global app settings (`app_settings.json`): one JSON object, owned by the frontend
//! (`getSetting/setSetting`), saved whole and debounced. Rust only stores it.

use std::sync::Mutex;

use serde_json::{Map, Value};
use tauri::State;

use super::jsonio::{read_json, write_json};
use super::paths::Paths;
use super::{err, CmdResult};

/// Serializes writes: the frontend debounces, but a flush on close can overlap a
/// scheduled save.
#[derive(Default)]
pub struct SettingsLock(Mutex<()>);

#[tauri::command]
pub fn settings_get(paths: State<'_, Paths>) -> Map<String, Value> {
    read_json(&paths.settings_file())
}

#[tauri::command]
pub fn settings_set(
    paths: State<'_, Paths>,
    lock: State<'_, SettingsLock>,
    value: Map<String, Value>,
) -> CmdResult<()> {
    let _g = lock.0.lock().map_err(err)?;
    write_json(&paths.settings_file(), &value).map_err(err)
}
