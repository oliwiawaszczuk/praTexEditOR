//! Project commands: registry, creation (template / folder / zip), folders, UI state.

pub mod detect;
pub mod registry;
pub mod templates;
pub mod zipimport;

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::core::jsonio::{read_json, write_json};
use crate::core::{err, CmdResult};
use crate::fs::guard;
use crate::fs::watcher::Watch;
use detect::MainCandidate;
use registry::{new_id, now_ms, Project, Projects};

/// Registry entry + what the start screen needs to know about the folders.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectView {
    #[serde(flatten)]
    project: Project,
    /// Same order as `roots`: false = folder missing (unplugged disk, moved, deleted).
    roots_ok: Vec<bool>,
}

impl From<Project> for ProjectView {
    fn from(p: Project) -> Self {
        let roots_ok = p.roots.iter().map(|r| r.is_dir()).collect();
        Self { project: p, roots_ok }
    }
}

fn canonical_dir(p: &Path) -> CmdResult<PathBuf> {
    let c = p.canonicalize().map_err(|_| "Folder nie istnieje".to_string())?;
    if c.is_dir() {
        Ok(c)
    } else {
        Err("To nie jest folder".into())
    }
}

#[tauri::command]
pub fn projects_list(reg: State<'_, Projects>) -> Vec<ProjectView> {
    let mut list = reg.list();
    list.sort_by_key(|p| std::cmp::Reverse(p.opened_at));
    list.into_iter().map(ProjectView::from).collect()
}

#[tauri::command]
pub fn project_create(
    reg: State<'_, Projects>,
    name: String,
    color: String,
    roots: Vec<PathBuf>,
    main: Option<PathBuf>,
) -> CmdResult<ProjectView> {
    let mut canon: Vec<PathBuf> = Vec::new();
    for r in &roots {
        let c = canonical_dir(r)?;
        if !canon.contains(&c) {
            canon.push(c);
        }
    }
    if canon.is_empty() {
        return Err("Projekt potrzebuje co najmniej jednego folderu".into());
    }
    let main = main.map(|m| guard::canonical(&m)).transpose()?;
    let p = Project {
        id: new_id(),
        name: name.trim().to_string(),
        color,
        roots: canon,
        main,
        created_at: now_ms(),
        opened_at: now_ms(),
    };
    reg.update(|l| {
        l.push(p.clone());
        Ok(())
    })?;
    Ok(p.into())
}

/// New folder `<parent>/<name>` (unique) filled from a template, registered as a project.
#[tauri::command]
pub fn project_from_template(
    reg: State<'_, Projects>,
    paths: State<'_, crate::core::paths::Paths>,
    template: String,
    name: String,
    parent: PathBuf,
    color: String,
) -> CmdResult<ProjectView> {
    let name = guard::valid_name(&name)?.to_string();
    let parent = canonical_dir(&parent)?;
    let dir = crate::fs::ops::unique_path(&parent, &name);
    let main_rel = if let Some(t) = templates::find(&template) {
        std::fs::create_dir(&dir).map_err(err)?;
        templates::write(t, &dir).map_err(err)?;
        "main.tex".to_string()
    } else {
        std::fs::create_dir(&dir).map_err(err)?;
        match templates::write_user(&paths, &template, &dir) {
            Ok(m) => m,
            Err(e) => {
                let _ = std::fs::remove_dir_all(&dir);
                return Err(e);
            }
        }
    };
    let main = dir.join(main_rel);
    let main = main.is_file().then_some(main);
    project_create(reg, name, color, vec![dir], main)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Unpacked {
    dir: PathBuf,
    files: usize,
    candidates: Vec<MainCandidate>,
}

/// Unpack a zip into a new folder `<parent>/<name>`; the UI then picks the main file
/// and calls `project_create`.
#[tauri::command]
pub async fn project_unzip(zip: PathBuf, parent: PathBuf, name: String) -> CmdResult<Unpacked> {
    let name = guard::valid_name(&name)?.to_string();
    let parent = canonical_dir(&parent)?;
    tauri::async_runtime::spawn_blocking(move || {
        let dir = crate::fs::ops::unique_path(&parent, &name);
        std::fs::create_dir(&dir).map_err(err)?;
        match zipimport::extract(&zip, &dir) {
            Ok(files) => Ok(Unpacked {
                candidates: detect::find_mains(&dir),
                dir,
                files,
            }),
            Err(e) => {
                let _ = std::fs::remove_dir_all(&dir);
                Err(e.to_string())
            }
        }
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn detect_main(dir: PathBuf) -> CmdResult<Vec<MainCandidate>> {
    tauri::async_runtime::spawn_blocking(move || detect::find_mains(&dir))
        .await
        .map_err(err)
}

#[tauri::command]
pub fn project_update(
    reg: State<'_, Projects>,
    id: String,
    name: Option<String>,
    color: Option<String>,
    main: Option<PathBuf>,
) -> CmdResult<ProjectView> {
    reg.update_one(&id, |p| {
        if let Some(n) = name.filter(|n| !n.trim().is_empty()) {
            p.name = n.trim().to_string();
        }
        if let Some(c) = color {
            p.color = c;
        }
        if let Some(m) = main {
            p.main = Some(guard::inside(p, &m)?);
        }
        Ok(())
    })
    .map(Into::into)
}

fn restart_watch(app: &AppHandle, p: &Project) {
    let watch = app.state::<Watch>();
    watch.stop();
    let live: Vec<PathBuf> = p.roots.iter().filter(|r| r.is_dir()).cloned().collect();
    let app2 = app.clone();
    watch.start(p.id.clone(), &live, move |change| {
        let _ = app2.emit("fs-changed", change);
    });
}

/// Attach another folder (`replace`: swap a missing one for its new location).
#[tauri::command]
pub fn project_set_root(
    app: AppHandle,
    reg: State<'_, Projects>,
    id: String,
    path: PathBuf,
    replace: Option<PathBuf>,
) -> CmdResult<ProjectView> {
    let c = canonical_dir(&path)?;
    let p = reg.update_one(&id, |p| {
        if p.roots.iter().any(|r| c.starts_with(r) || r.starts_with(&c)) && replace.is_none() {
            return Err("Ten folder (albo folder nad nim) już jest w projekcie".into());
        }
        match replace.and_then(|old| p.roots.iter().position(|r| *r == old)) {
            Some(i) => p.roots[i] = c.clone(),
            None => p.roots.push(c.clone()),
        }
        Ok(())
    })?;
    restart_watch(&app, &p);
    Ok(p.into())
}

/// Detach a folder from the project (the folder itself is untouched).
#[tauri::command]
pub fn project_remove_root(app: AppHandle, reg: State<'_, Projects>, id: String, path: PathBuf) -> CmdResult<ProjectView> {
    let p = reg.update_one(&id, |p| {
        if p.roots.len() <= 1 {
            return Err("To ostatni folder projektu".into());
        }
        p.roots.retain(|r| *r != path);
        if p.main.as_ref().is_some_and(|m| m.starts_with(&path)) {
            p.main = None;
        }
        Ok(())
    })?;
    restart_watch(&app, &p);
    Ok(p.into())
}

#[tauri::command]
pub fn project_forget(app: AppHandle, reg: State<'_, Projects>, id: String) -> CmdResult<()> {
    if app.state::<OpenProject>().get().as_deref() == Some(id.as_str()) {
        app.state::<Watch>().stop();
        app.state::<OpenProject>().set(None);
    }
    reg.forget(&id)?;
    let _ = std::fs::remove_dir_all(app.state::<crate::core::paths::Paths>().build_dir(&id));
    Ok(())
}

/// Id of the project shown in the window (one at a time).
#[derive(Default)]
pub struct OpenProject(std::sync::Mutex<Option<String>>);

impl OpenProject {
    pub fn get(&self) -> Option<String> {
        self.0.lock().unwrap().clone()
    }
    fn set(&self, v: Option<String>) {
        *self.0.lock().unwrap() = v;
    }
}

#[tauri::command]
pub fn project_open(app: AppHandle, reg: State<'_, Projects>, open: State<'_, OpenProject>, id: String) -> CmdResult<ProjectView> {
    let p = reg.update_one(&id, |p| {
        p.opened_at = now_ms();
        Ok(())
    })?;
    restart_watch(&app, &p);
    open.set(Some(id));
    Ok(p.into())
}

#[tauri::command]
pub fn project_close(watch: State<'_, Watch>, open: State<'_, OpenProject>) {
    watch.stop();
    open.set(None);
}

#[tauri::command]
pub fn project_state_get(reg: State<'_, Projects>, id: String) -> Map<String, Value> {
    read_json(&reg.state_file(&id))
}

#[tauri::command]
pub fn project_state_set(reg: State<'_, Projects>, id: String, value: Map<String, Value>) -> CmdResult<()> {
    reg.get(&id)?; // never resurrect a forgotten project's folder
    write_json(&reg.state_file(&id), &value).map_err(err)
}

/// Default place for new project folders: ~/Documents (or home).
#[tauri::command]
pub fn default_parent_dir(app: AppHandle) -> Option<PathBuf> {
    let p = app.path();
    p.document_dir().or_else(|_| p.home_dir()).ok()
}
