//! Project registry: `<data>/projects/registry.json` (light list for the start screen)
//! plus `<data>/projects/<id>/state.json` (per-project UI state, `wsGet/wsSet`).
//! A project only *points* at folders — deleting a project never touches them.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::core::jsonio::{read_json, write_json};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub color: String,
    /// Canonical absolute folder paths, in tree order.
    pub roots: Vec<PathBuf>,
    /// Absolute path of the main `.tex`, inside one of the roots.
    pub main: Option<PathBuf>,
    pub created_at: u64,
    pub opened_at: u64,
}

#[derive(Default, Serialize, Deserialize)]
struct Registry {
    projects: Vec<Project>,
}

pub struct Projects {
    dir: PathBuf,
    lock: Mutex<()>,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 12 hex chars, unique enough for a personal registry (time + counter + pid).
pub fn new_id() -> String {
    static N: AtomicU64 = AtomicU64::new(0);
    let mut h = DefaultHasher::new();
    (now_ms(), N.fetch_add(1, Ordering::Relaxed), std::process::id()).hash(&mut h);
    format!("{:012x}", h.finish() & 0xffff_ffff_ffff)
}

impl Projects {
    pub fn new(data: &Path) -> Self {
        Self {
            dir: data.join("projects"),
            lock: Mutex::new(()),
        }
    }

    fn file(&self) -> PathBuf {
        self.dir.join("registry.json")
    }

    pub fn state_file(&self, id: &str) -> PathBuf {
        self.dir.join(id).join("state.json")
    }

    pub fn list(&self) -> Vec<Project> {
        let _g = self.lock.lock().unwrap();
        read_json::<Registry>(&self.file()).projects
    }

    pub fn get(&self, id: &str) -> Result<Project, String> {
        self.list()
            .into_iter()
            .find(|p| p.id == id)
            .ok_or_else(|| "Nie ma takiego projektu".to_string())
    }

    /// Read-modify-write under the lock; `f` returns the value handed back to the caller.
    pub fn update<R>(&self, f: impl FnOnce(&mut Vec<Project>) -> Result<R, String>) -> Result<R, String> {
        let _g = self.lock.lock().unwrap();
        let mut reg: Registry = read_json(&self.file());
        let r = f(&mut reg.projects)?;
        write_json(&self.file(), &reg).map_err(|e| e.to_string())?;
        Ok(r)
    }

    pub fn update_one(&self, id: &str, f: impl FnOnce(&mut Project) -> Result<(), String>) -> Result<Project, String> {
        self.update(|list| {
            let p = list
                .iter_mut()
                .find(|p| p.id == id)
                .ok_or_else(|| "Nie ma takiego projektu".to_string())?;
            f(p)?;
            Ok(p.clone())
        })
    }

    /// Forget a project: registry entry + its state folder. User folders stay.
    pub fn forget(&self, id: &str) -> Result<(), String> {
        self.update(|list| {
            list.retain(|p| p.id != id);
            Ok(())
        })?;
        let _ = std::fs::remove_dir_all(self.dir.join(id));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str) -> Project {
        Project {
            id: id.into(),
            name: "P".into(),
            color: "#ffc951".into(),
            roots: vec![],
            main: None,
            created_at: 0,
            opened_at: 0,
        }
    }

    #[test]
    fn crud() {
        let d = tempfile::tempdir().unwrap();
        let reg = Projects::new(d.path());
        reg.update(|l| {
            l.push(sample("a"));
            l.push(sample("b"));
            Ok(())
        })
        .unwrap();
        reg.update_one("a", |p| {
            p.name = "Praca".into();
            Ok(())
        })
        .unwrap();
        assert_eq!(reg.get("a").unwrap().name, "Praca");
        std::fs::create_dir_all(d.path().join("projects/a")).unwrap();
        reg.forget("a").unwrap();
        assert!(reg.get("a").is_err());
        assert!(!d.path().join("projects/a").exists());
        assert_eq!(reg.list().len(), 1);
    }

    #[test]
    fn ids_differ() {
        assert_ne!(new_id(), new_id());
        assert_eq!(new_id().len(), 12);
    }
}
