use std::io;
use std::path::PathBuf;

use tauri::Manager;

/// Where the app keeps its own files. Nothing here ever goes into user folders.
///
/// Debug builds use `<identifier>.dev` siblings, so `./dev.sh` never touches the data of
/// an installed release.
#[derive(Debug, Clone)]
pub struct Paths {
    /// Settings, projects registry, notes, boards — must survive.
    pub data: PathBuf,
    /// Build outputs, warm-up/self-test scratch — safe to delete at any time.
    pub cache: PathBuf,
}

impl Paths {
    pub fn resolve(app: &tauri::AppHandle) -> io::Result<Self> {
        let p = app.path();
        let data = p.app_data_dir().map_err(io::Error::other)?;
        let cache = p.app_cache_dir().map_err(io::Error::other)?;
        Self::at(dev_variant(data), dev_variant(cache))
    }

    pub fn at(data: PathBuf, cache: PathBuf) -> io::Result<Self> {
        std::fs::create_dir_all(&data)?;
        std::fs::create_dir_all(&cache)?;
        Ok(Self { data, cache })
    }

    pub fn settings_file(&self) -> PathBuf {
        self.data.join("app_settings.json")
    }

    pub fn engine_marker(&self) -> PathBuf {
        self.data.join("engine.json")
    }

    /// Build outputs of one project (engine outdirs + the published PDF).
    pub fn build_dir(&self, pid: &str) -> PathBuf {
        self.cache.join("build").join(pid)
    }

    /// Scratch dir for one internal job (warm-up, self-test).
    pub fn scratch(&self, name: &str) -> PathBuf {
        self.cache.join(name)
    }
}

fn dev_variant(p: PathBuf) -> PathBuf {
    if !cfg!(debug_assertions) {
        return p;
    }
    let name = p
        .file_name()
        .map(|n| format!("{}.dev", n.to_string_lossy()))
        .unwrap_or_else(|| "pratex.dev".into());
    p.with_file_name(name)
}

