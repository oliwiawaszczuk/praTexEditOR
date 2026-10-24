//! The user's own data files next to the settings: `keybindings.json` (shortcut
//! overrides) and `snippets.json` (own / changed snippets). The frontend owns their
//! shape; Rust only stores them, atomically. Plus importing VS Code JSON files
//! (keybindings, snippets), which allow comments and trailing commas.

use std::sync::Mutex;

use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use super::jsonio::{read_json, write_json};
use super::paths::Paths;
use super::{err, CmdResult};

const FILES: &[&str] = &["keybindings", "snippets"];

#[derive(Default)]
pub struct UserDataLock(Mutex<()>);

fn file(paths: &Paths, name: &str) -> CmdResult<std::path::PathBuf> {
    if !FILES.contains(&name) {
        return Err("Nieznany plik danych".into());
    }
    Ok(paths.data.join(format!("{name}.json")))
}

#[tauri::command]
pub fn userdata_get(paths: State<'_, Paths>, name: String) -> CmdResult<Value> {
    let v: Value = read_json(&file(&paths, &name)?);
    Ok(v)
}

#[tauri::command]
pub fn userdata_set(paths: State<'_, Paths>, lock: State<'_, UserDataLock>, name: String, value: Value) -> CmdResult<()> {
    let _g = lock.0.lock().map_err(err)?;
    write_json(&file(&paths, &name)?, &value).map_err(err)
}

/// JSON with comments (`//`, `/* */`) and trailing commas → plain JSON.
pub fn strip_jsonc(s: &str) -> String {
    let b: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    let mut in_str = false;
    while i < b.len() {
        let c = b[i];
        if in_str {
            out.push(c);
            if c == '\\' && i + 1 < b.len() {
                out.push(b[i + 1]);
                i += 2;
                continue;
            }
            if c == '"' {
                in_str = false;
            }
            i += 1;
            continue;
        }
        match c {
            '"' => {
                in_str = true;
                out.push(c);
                i += 1;
            }
            '/' if b.get(i + 1) == Some(&'/') => {
                while i < b.len() && b[i] != '\n' {
                    i += 1;
                }
            }
            '/' if b.get(i + 1) == Some(&'*') => {
                i += 2;
                while i + 1 < b.len() && !(b[i] == '*' && b[i + 1] == '/') {
                    i += 1;
                }
                i += 2;
            }
            ',' => {
                // Drop a comma that only whitespace / comments separate from } or ].
                let mut j = i + 1;
                while j < b.len() && b[j].is_whitespace() {
                    j += 1;
                }
                if !matches!(b.get(j), Some('}') | Some(']')) {
                    out.push(c);
                }
                i += 1;
            }
            _ => {
                out.push(c);
                i += 1;
            }
        }
    }
    out
}

/// Pick a JSON file with the system dialog (opened here, the path never comes from the
/// webview) and return its content. None = cancelled.
#[tauri::command]
pub async fn import_json_file(app: AppHandle, title: String) -> CmdResult<Option<Value>> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        let mut d = app.dialog().file().set_title(title).add_filter("JSON", &["json", "code-snippets", "jsonc"]);
        if let Ok(home) = app.path().home_dir() {
            d = d.set_directory(home);
        }
        let Some(p) = d.blocking_pick_file() else { return Ok(None) };
        let path = p.into_path().map_err(err)?;
        let meta = std::fs::metadata(&path).map_err(err)?;
        if meta.len() > 4 * 1024 * 1024 {
            return Err("Plik jest za duży".into());
        }
        let text = std::fs::read_to_string(&path).map_err(|_| "To nie jest plik tekstowy UTF-8".to_string())?;
        serde_json::from_str(&strip_jsonc(&text)).map(Some).map_err(|e| format!("To nie jest poprawny JSON: {e}"))
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jsonc() {
        let s = r#"// Place your key bindings in this file
[
  { "key": "cmd+b", /* bold */ "command": "latex-workshop.bold", },
  { "key": "cmd+i", "command": "x//y", "when": "a \" // b" },
]"#;
        let v: Value = serde_json::from_str(&strip_jsonc(s)).unwrap();
        assert_eq!(v[0]["key"], "cmd+b");
        assert_eq!(v[1]["command"], "x//y");
        assert_eq!(v[1]["when"], "a \" // b");
        assert_eq!(v.as_array().unwrap().len(), 2);
    }
}
