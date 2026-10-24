//! File tree commands for the open project. Paths are always checked against the
//! project's folders (`guard`), so the UI cannot reach anything else.

pub mod guard;
pub mod ops;
pub mod text;
pub mod tree;
pub mod watcher;

use std::path::PathBuf;

use tauri::State;

use crate::core::{err, CmdResult};
use crate::projects::registry::Projects;
use ops::{Policy, Transfer};
use text::{Read, Stamp};
use tree::{Entry, Visibility};

fn project(reg: &Projects, pid: &str) -> CmdResult<crate::projects::registry::Project> {
    reg.get(pid)
}

#[tauri::command]
pub fn fs_list(reg: State<'_, Projects>, pid: String, dir: PathBuf, vis: Visibility) -> CmdResult<Vec<Entry>> {
    let p = project(&reg, &pid)?;
    let dir = guard::inside(&p, &dir)?;
    tree::list(&dir, vis).map_err(err)
}

#[tauri::command]
pub async fn fs_search(reg: State<'_, Projects>, pid: String, query: String, vis: Visibility) -> CmdResult<Vec<Entry>> {
    let p = project(&reg, &pid)?;
    tauri::async_runtime::spawn_blocking(move || tree::search(&p.roots, &query, vis, 300))
        .await
        .map_err(err)
}

/// Every file and folder of the project (quick open ⌘P, folder pickers), without
/// ignored / hidden / TeX by-product entries. Capped: a project is not a home folder.
#[tauri::command]
pub async fn fs_files(reg: State<'_, Projects>, pid: String) -> CmdResult<Vec<Entry>> {
    let p = project(&reg, &pid)?;
    tauri::async_runtime::spawn_blocking(move || tree::search(&p.roots, "", Visibility::default(), 20_000))
        .await
        .map_err(err)
}

/// A pasted image (raw bytes in the request body, no JSON): headers `pid`, `dir` and
/// `name` (percent-encoded). Never overwrites: a clash gets `name-2.png`. The folder is
/// created when missing. Returns the final path.
#[tauri::command]
pub fn fs_write_image(reg: State<'_, Projects>, request: tauri::ipc::Request<'_>) -> CmdResult<PathBuf> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Brak danych obrazu".into());
    };
    let header = |k: &str| -> CmdResult<String> {
        let v = request.headers().get(k).and_then(|v| v.to_str().ok()).ok_or("Brak nagłówka")?;
        Ok(crate::protocol::decode(v))
    };
    let p = project(&reg, &header("pid")?)?;
    let dir = guard::inside(&p, &PathBuf::from(header("dir")?))?;
    let name = guard::valid_name(&header("name")?)?.to_string();
    if bytes.is_empty() || bytes.len() > 64 * 1024 * 1024 {
        return Err("Pusty albo za duży obraz".into());
    }
    std::fs::create_dir_all(&dir).map_err(err)?;
    let target = ops::unique_path(&dir, &name);
    let tmp = dir.join(format!(".{name}.pratex~"));
    std::fs::write(&tmp, bytes).map_err(err)?;
    std::fs::rename(&tmp, &target).map_err(err)?;
    Ok(target)
}

/// Make sure a folder of the project exists (image folder before a copy into it).
#[tauri::command]
pub fn fs_ensure_dir(reg: State<'_, Projects>, pid: String, dir: PathBuf) -> CmdResult<()> {
    let p = project(&reg, &pid)?;
    let dir = guard::inside(&p, &dir)?;
    std::fs::create_dir_all(dir).map_err(err)
}

#[tauri::command]
pub fn fs_create(reg: State<'_, Projects>, pid: String, dir: PathBuf, name: String, folder: bool) -> CmdResult<PathBuf> {
    let p = project(&reg, &pid)?;
    let dir = guard::inside(&p, &dir)?;
    let name = guard::valid_name(&name)?;
    let r = if folder { ops::create_dir(&dir, name) } else { ops::create_file(&dir, name) };
    r.map_err(|e| match e.kind() {
        std::io::ErrorKind::AlreadyExists => "Plik o tej nazwie już istnieje".to_string(),
        _ => e.to_string(),
    })
}

#[tauri::command]
pub fn fs_rename(reg: State<'_, Projects>, pid: String, path: PathBuf, name: String) -> CmdResult<PathBuf> {
    let p = project(&reg, &pid)?;
    let path = guard::inside(&p, &path)?;
    if guard::is_root(&p, &path) {
        return Err("Nazwę podpiętego folderu zmień w Finderze".into());
    }
    ops::rename(&path, guard::valid_name(&name)?).map_err(err)
}

/// Move (or copy) items into a project folder. Copy sources may come from outside the
/// project (files dropped from Finder); moved sources must be inside it.
#[tauri::command]
pub async fn fs_transfer(
    reg: State<'_, Projects>,
    pid: String,
    sources: Vec<PathBuf>,
    target: PathBuf,
    copy: bool,
    policy: Policy,
) -> CmdResult<Transfer> {
    let p = project(&reg, &pid)?;
    let target = guard::inside(&p, &target)?;
    let sources = sources
        .iter()
        .map(|s| {
            if copy {
                guard::canonical(s)
            } else {
                let c = guard::inside(&p, s)?;
                if guard::is_root(&p, &c) {
                    return Err("Podpiętego folderu nie można przenieść".to_string());
                }
                Ok(c)
            }
        })
        .collect::<CmdResult<Vec<_>>>()?;
    tauri::async_runtime::spawn_blocking(move || ops::transfer(&sources, &target, copy, policy))
        .await
        .map_err(err)?
        .map_err(err)
}

#[tauri::command]
pub async fn fs_trash(reg: State<'_, Projects>, pid: String, paths: Vec<PathBuf>) -> CmdResult<()> {
    let p = project(&reg, &pid)?;
    let paths = paths
        .iter()
        .map(|x| {
            let c = guard::inside(&p, x)?;
            if guard::is_root(&p, &c) {
                return Err("Podpięty folder odłącz z menu, zamiast go usuwać".to_string());
            }
            Ok(c)
        })
        .collect::<CmdResult<Vec<_>>>()?;
    tauri::async_runtime::spawn_blocking(move || trash::delete_all(&paths))
        .await
        .map_err(err)?
        .map_err(err)
}

#[tauri::command]
pub fn fs_duplicate(reg: State<'_, Projects>, pid: String, path: PathBuf) -> CmdResult<PathBuf> {
    let p = project(&reg, &pid)?;
    ops::duplicate(&guard::inside(&p, &path)?).map_err(err)
}

#[tauri::command]
pub fn fs_reveal(reg: State<'_, Projects>, pid: String, path: PathBuf) -> CmdResult<()> {
    let p = project(&reg, &pid)?;
    ops::reveal(&guard::inside(&p, &path)?).map_err(err)
}

/// Open a file in the editor. `known` = the stamp the editor already has (watcher echo
/// of our own save → `Unchanged`, no read).
#[tauri::command]
pub async fn fs_read(reg: State<'_, Projects>, pid: String, path: PathBuf, known: Option<Stamp>) -> CmdResult<Read> {
    let p = project(&reg, &pid)?;
    let path = guard::inside(&p, &path)?;
    tauri::async_runtime::spawn_blocking(move || text::read(&path, known))
        .await
        .map_err(err)?
        .map_err(err)
}

#[tauri::command]
pub async fn fs_write(
    reg: State<'_, Projects>,
    pid: String,
    path: PathBuf,
    text: String,
    crlf: bool,
    bom: bool,
) -> CmdResult<Stamp> {
    let p = project(&reg, &pid)?;
    let path = guard::inside(&p, &path)?;
    if guard::is_root(&p, &path) || path.is_dir() {
        return Err("To jest folder".into());
    }
    tauri::async_runtime::spawn_blocking(move || text::write(&path, &text, crlf, bom))
        .await
        .map_err(err)?
        .map_err(|e| format!("Nie udało się zapisać: {e}"))
}
