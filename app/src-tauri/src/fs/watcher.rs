//! Watches the open project's folders. Raw `notify` events go into a channel; one thread
//! sleeps on `recv()` (no wake-ups while nothing changes), then gathers the burst until
//! 120 ms of quiet and emits a single `fs-changed` with the affected folders.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::time::Duration;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;

use super::tree::is_ignored_dir;

const QUIET: Duration = Duration::from_millis(120);

#[derive(Default)]
pub struct Watch(Mutex<Option<Active>>);

struct Active {
    // Dropping the watcher closes the channel and ends the thread.
    _watcher: RecommendedWatcher,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsChanged {
    pub pid: String,
    /// Folders whose listing may differ (parents of changed paths, plus changed folders).
    pub dirs: Vec<PathBuf>,
    /// The changed paths themselves (open editor tabs re-check theirs).
    pub paths: Vec<PathBuf>,
}

fn ignored(p: &Path) -> bool {
    // `.name.pratex~` = the editor's atomic-save temp file (the rename onto the real
    // name is reported separately).
    p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.ends_with(".pratex~"))
        || p.components()
            .any(|c| c.as_os_str().to_str().is_some_and(is_ignored_dir))
}

impl Watch {
    /// Replace any previous watch. `on_change` runs on the watcher thread once per burst.
    pub fn start(&self, pid: String, roots: &[PathBuf], on_change: impl Fn(FsChanged) + Send + 'static) {
        let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
        let mut watcher = match notify::recommended_watcher(tx) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("[pratex] watcher: {e}");
                return;
            }
        };
        for r in roots {
            if let Err(e) = watcher.watch(r, RecursiveMode::Recursive) {
                eprintln!("[pratex] watch {}: {e}", r.display());
            }
        }
        std::thread::spawn(move || {
            while let Ok(first) = rx.recv() {
                let mut paths = BTreeSet::new();
                let mut take = |res: notify::Result<notify::Event>| {
                    if let Ok(ev) = res {
                        if matches!(ev.kind, EventKind::Access(_)) {
                            return;
                        }
                        paths.extend(ev.paths.into_iter().filter(|p| !ignored(p)));
                    }
                };
                take(first);
                loop {
                    match rx.recv_timeout(QUIET) {
                        Ok(res) => take(res),
                        Err(RecvTimeoutError::Timeout) => break,
                        Err(RecvTimeoutError::Disconnected) => return,
                    }
                }
                if paths.is_empty() {
                    continue;
                }
                let mut dirs = BTreeSet::new();
                for p in &paths {
                    if let Some(parent) = p.parent() {
                        dirs.insert(parent.to_path_buf());
                    }
                    dirs.insert(p.clone());
                }
                on_change(FsChanged {
                    pid: pid.clone(),
                    dirs: dirs.into_iter().collect(),
                    paths: paths.into_iter().collect(),
                });
            }
        });
        *self.0.lock().unwrap() = Some(Active { _watcher: watcher });
    }

    pub fn stop(&self) {
        self.0.lock().unwrap().take();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;

    #[test]
    fn bursts_are_batched_and_noise_ignored() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().canonicalize().unwrap();
        std::fs::create_dir(root.join("sub")).unwrap();
        std::fs::create_dir(root.join(".git")).unwrap();
        let (tx, rx) = channel();
        let w = Watch::default();
        w.start("p".into(), std::slice::from_ref(&root), move |c| tx.send(c).unwrap());
        std::thread::sleep(Duration::from_millis(300)); // FSEvents needs a moment to arm
        for i in 0..5 {
            std::fs::write(root.join("sub").join(format!("{i}.tex")), "x").unwrap();
        }
        std::fs::write(root.join(".git/HEAD"), "x").unwrap();

        let first = rx.recv_timeout(Duration::from_secs(5)).expect("no event");
        let mut all = first.paths.clone();
        while let Ok(more) = rx.recv_timeout(Duration::from_millis(600)) {
            all.extend(more.paths);
        }
        assert_eq!(first.pid, "p");
        assert!(first.dirs.contains(&root.join("sub")), "{:?}", first.dirs);
        assert!(all.iter().all(|p| !p.starts_with(root.join(".git"))), "{all:?}");
        assert!(all.contains(&root.join("sub/4.tex")), "{all:?}");
        w.stop();
    }
}
