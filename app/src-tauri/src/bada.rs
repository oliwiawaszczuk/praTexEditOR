//! Client of praBada's door (`<data>/link.sock`: one JSON line per request, one per answer,
//! protocol v1). Per action, no standing connection. praBada is the other side of the
//! "source of truth" split: this app owns the TeX folder, praBada only reads/jumps.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

use crate::core::{err, CmdResult};

const ID: &str = "com.praoliwia.praBada";

/// A file handed over by the system (`open -a praTexEditOR file`) that the page has not
/// taken yet: it can arrive before the page listens, so the event only says "look".
static PENDING: Mutex<Option<String>> = Mutex::new(None);

/// A debug build talks to praBada's dev data first.
fn data_dirs() -> Vec<PathBuf> {
    let Some(home) = std::env::var_os("HOME") else { return Vec::new() };
    let base = PathBuf::from(home).join("Library/Application Support");
    let (release, dev) = (base.join(ID), base.join(format!("{ID}.dev")));
    if cfg!(debug_assertions) { vec![dev, release] } else { vec![release] }
}

fn connect() -> Option<UnixStream> {
    data_dirs().iter().find_map(|d| UnixStream::connect(d.join("link.sock")).ok())
}

fn ask(mut s: UnixStream, req: &Value) -> CmdResult<Value> {
    s.set_read_timeout(Some(Duration::from_secs(10))).map_err(err)?;
    writeln!(s, "{req}").map_err(|_| "praBada przerwała połączenie".to_string())?;
    let mut line = String::new();
    BufReader::new(s).read_line(&mut line).map_err(|_| "praBada nie odpowiedziała na czas".to_string())?;
    let v: Value = serde_json::from_str(line.trim()).map_err(|_| "Niezrozumiała odpowiedź praBady".to_string())?;
    if v["ok"] == json!(true) { Ok(v) } else { Err(v["error"].as_str().unwrap_or("praBada odrzuciła żądanie").to_string()) }
}

fn wake() -> Option<UnixStream> {
    std::process::Command::new("open").args(["-g", "-a", "praBada"]).status().ok().filter(|s| s.success())?;
    let until = Instant::now() + Duration::from_secs(8);
    while Instant::now() < until {
        if let Some(s) = connect() {
            return Some(s);
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    None
}

/// Only the operations this app uses; the door itself would accept more.
pub fn send(req: &Value) -> CmdResult<Value> {
    if !matches!(req["op"].as_str(), Some("ws.list" | "open")) {
        return Err("Nieobsługiwana operacja".into());
    }
    ask(connect().or_else(wake).ok_or("Nie udało się uruchomić praBady")?, req)
}

/// Off the async runtime's threads: it blocks on the socket.
#[tauri::command]
pub async fn bada_send(req: Value) -> CmdResult<Value> {
    tauri::async_runtime::spawn_blocking(move || send(&req)).await.map_err(err)?
}

/// macOS hands over files opened with this app (Finder, `open -a`, praBada's "Otwórz w…").
pub fn opened(app: &AppHandle, urls: &[tauri::Url]) {
    let Some(path) = urls.iter().find_map(|u| u.to_file_path().ok()) else { return };
    *PENDING.lock().unwrap() = Some(path.to_string_lossy().into_owned());
    let _ = app.emit("external-open", ());
}

#[tauri::command]
pub fn external_pending_take() -> Option<String> {
    PENDING.lock().unwrap().take()
}
