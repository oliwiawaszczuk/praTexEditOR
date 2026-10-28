//! Local version control (libgit2, no network, no `git` binary needed). A repository is
//! always a project root itself; every command gets `pid` + the root and re-opens the
//! repository (cheap), so nothing stays locked between calls.

pub mod diff;
pub mod ops;

use std::collections::HashMap;
use std::ops::Deref;
use std::path::{Path, PathBuf};

use git2::{Repository, StatusOptions};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::core::{err, CmdResult};
use crate::fs::guard;
use crate::projects::registry::{Project, Projects};

pub(crate) fn git_err(e: git2::Error) -> String {
    format!("Git: {}", e.message())
}

/// A repository plus where the project folder sits inside it: the repository may live
/// in a parent folder of the project (found by walking up), in which case everything is
/// limited to the project folder and paths are reported relative to it.
pub(crate) struct Repo {
    repo: Repository,
    /// "" when the project folder is the repository root, else "sub/dir/" (trailing slash).
    pub prefix: String,
}

impl Deref for Repo {
    type Target = Repository;
    fn deref(&self) -> &Repository {
        &self.repo
    }
}

impl Repo {
    pub fn new(repo: Repository, prefix: &str) -> Self {
        Self { repo, prefix: prefix.to_string() }
    }
    /// Project-relative → repository-relative.
    pub fn add(&self, p: &str) -> String {
        format!("{}{}", self.prefix, p)
    }
    pub fn strip<'a>(&self, p: &'a str) -> Option<&'a str> {
        p.strip_prefix(self.prefix.as_str())
    }
    /// The project folder as a pathspec; `None` when it is the whole repository.
    pub fn scope(&self) -> Option<String> {
        (!self.prefix.is_empty()).then(|| self.prefix.trim_end_matches('/').to_string())
    }
    /// Pathspec for `path` (project-relative), or for the whole project folder.
    pub fn spec(&self, path: Option<&str>) -> Option<String> {
        path.map(|p| self.add(p)).or_else(|| self.scope())
    }
    pub fn workdir_path(&self) -> PathBuf {
        self.repo.workdir().map(Path::to_path_buf).unwrap_or_default()
    }
}

/// The first repository found from `root` upwards (the folder itself, then its parents).
pub(crate) fn discover(root: &Path) -> Option<Repo> {
    let repo = Repository::discover(root).ok()?;
    let work = repo.workdir()?.canonicalize().ok()?;
    let rel = root.canonicalize().ok()?.strip_prefix(&work).ok()?.to_path_buf();
    let parts: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    let prefix = if parts.is_empty() { String::new() } else { format!("{}/", parts.join("/")) };
    Some(Repo::new(repo, &prefix))
}

/// The project's root `root` (checked against the project) opened as a repository.
pub(crate) fn open(app: &AppHandle, pid: &str, root: &Path) -> CmdResult<Repo> {
    let project = app.state::<Projects>().get(pid)?;
    open_in(&project, root)
}

pub(crate) fn open_in(project: &Project, root: &Path) -> CmdResult<Repo> {
    let root = guard::canonical(root)?;
    if !guard::is_root(project, &root) {
        return Err("To nie jest folder główny projektu".into());
    }
    discover(&root).ok_or_else(|| "Ten folder nie jest repozytorium Git".to_string())
}

/// Repo-relative path, always with `/`.
pub(crate) fn rel(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub root: PathBuf,
    pub name: String,
    pub is_repo: bool,
    pub branch: Option<String>,
    pub detached: bool,
    /// HEAD commit, short; `None` before the first commit.
    pub head: Option<String>,
    pub changes: u32,
    /// Where the repository lives when it is above the project folder.
    pub repo_root: Option<PathBuf>,
}

fn info(root: &Path) -> RepoInfo {
    let name = root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let mut out = RepoInfo { root: root.to_path_buf(), name, is_repo: false, branch: None, detached: false, head: None, changes: 0, repo_root: None };
    let Some(repo) = discover(root) else { return out };
    if !repo.prefix.is_empty() {
        out.repo_root = Some(repo.workdir_path());
    }
    out.is_repo = true;
    match repo.head() {
        Ok(h) => {
            out.detached = !h.is_branch();
            out.branch = h.shorthand().ok().map(str::to_string);
            out.head = h.target().map(|o| short(&o.to_string()));
        }
        // Unborn branch: the name lives in HEAD's symbolic target.
        Err(_) => {
            out.branch = repo
                .find_reference("HEAD")
                .ok()
                .and_then(|r| r.symbolic_target().ok().flatten().map(|t| t.trim_start_matches("refs/heads/").to_string()));
        }
    }
    out.changes = repo.statuses(Some(&mut status_opts(&repo))).map(|s| s.len() as u32).unwrap_or(0);
    out
}

fn short(id: &str) -> String {
    id.chars().take(7).collect()
}

fn status_opts(repo: &Repo) -> StatusOptions {
    let mut o = StatusOptions::new();
    if let Some(s) = repo.scope() {
        o.pathspec(s);
    }
    o.include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);
    o
}

/// One entry per project root (also the ones that are not repositories yet).
#[tauri::command]
pub async fn git_repos(app: AppHandle, pid: String) -> CmdResult<Vec<RepoInfo>> {
    let project = app.state::<Projects>().get(&pid)?;
    tauri::async_runtime::spawn_blocking(move || project.roots.iter().filter(|r| r.is_dir()).map(|r| info(r)).collect())
        .await
        .map_err(err)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub id: String,
    pub short: String,
    pub summary: String,
    pub message: String,
    pub author: String,
    /// Seconds since the epoch.
    pub time: i64,
    pub parents: u32,
    /// Branch / tag names pointing here (HEAD first).
    pub refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogPage {
    pub commits: Vec<CommitInfo>,
    pub more: bool,
}

fn ref_names(repo: &Repository) -> HashMap<git2::Oid, Vec<String>> {
    let mut map: HashMap<git2::Oid, Vec<String>> = HashMap::new();
    if let Ok(refs) = repo.references() {
        for r in refs.flatten() {
            let Ok(name) = r.shorthand().map(str::to_string) else { continue };
            if r.name().is_ok_and(|n| n.starts_with("refs/remotes/") || n.starts_with("refs/stash")) {
                continue;
            }
            if let Ok(c) = r.peel_to_commit() {
                map.entry(c.id()).or_default().push(name);
            }
        }
    }
    if let Some(head) = repo.head().ok().and_then(|h| h.target()) {
        let list = map.entry(head).or_default();
        list.insert(0, "HEAD".into());
    }
    map
}

fn log_of(repo: &Repo, path: Option<&str>, skip: usize, limit: usize) -> CmdResult<LogPage> {
    let spec = repo.spec(path);
    let mut walk = repo.revwalk().map_err(git_err)?;
    walk.set_sorting(git2::Sort::TIME | git2::Sort::TOPOLOGICAL).map_err(git_err)?;
    if walk.push_head().is_err() {
        return Ok(LogPage { commits: vec![], more: false });
    }
    let refs = ref_names(repo);
    let mut opts = git2::DiffOptions::new();
    if let Some(p) = &spec {
        opts.pathspec(p);
    }
    let mut commits = Vec::with_capacity(limit);
    let mut seen = 0usize;
    let mut more = false;
    for oid in walk {
        let c = repo.find_commit(oid.map_err(git_err)?).map_err(git_err)?;
        if spec.is_some() {
            // Only commits whose first-parent diff touches the path.
            let tree = c.tree().map_err(git_err)?;
            let parent = c.parent(0).ok().and_then(|p| p.tree().ok());
            let d = repo.diff_tree_to_tree(parent.as_ref(), Some(&tree), Some(&mut opts)).map_err(git_err)?;
            if d.deltas().len() == 0 {
                continue;
            }
        }
        if seen < skip {
            seen += 1;
            continue;
        }
        if commits.len() == limit {
            more = true;
            break;
        }
        let msg = c.message().unwrap_or("").trim().to_string();
        commits.push(CommitInfo {
            id: c.id().to_string(),
            short: short(&c.id().to_string()),
            summary: c.summary().ok().flatten().unwrap_or("").to_string(),
            message: msg,
            author: c.author().name().unwrap_or("").to_string(),
            time: c.time().seconds(),
            parents: c.parent_count() as u32,
            refs: refs.get(&c.id()).cloned().unwrap_or_default(),
        });
    }
    Ok(LogPage { commits, more })
}

#[tauri::command]
pub async fn git_log(app: AppHandle, pid: String, root: PathBuf, path: Option<String>, skip: usize, limit: usize) -> CmdResult<LogPage> {
    tauri::async_runtime::spawn_blocking(move || log_of(&open(&app, &pid, &root)?, path.as_deref(), skip, limit.clamp(1, 500)))
        .await
        .map_err(err)?
}

#[cfg(test)]
pub(crate) mod testutil {
    use git2::{Repository, Signature};
    use std::path::Path;

    pub fn repo(dir: &Path) -> super::Repo {
        let r = Repository::init(dir).unwrap();
        let mut cfg = r.config().unwrap();
        cfg.set_str("user.name", "Test").unwrap();
        cfg.set_str("user.email", "t@example.com").unwrap();
        super::Repo::new(r, "")
    }

    pub fn commit_all(r: &Repository, msg: &str) -> git2::Oid {
        let mut idx = r.index().unwrap();
        idx.add_all(["*"], git2::IndexAddOption::DEFAULT, None).unwrap();
        idx.update_all(["*"], None).unwrap();
        idx.write().unwrap();
        let tree = r.find_tree(idx.write_tree().unwrap()).unwrap();
        let sig = Signature::now("Test", "t@example.com").unwrap();
        let parents: Vec<_> = r.head().ok().and_then(|h| h.peel_to_commit().ok()).into_iter().collect();
        r.commit(Some("HEAD"), &sig, &sig, msg, &tree, &parents.iter().collect::<Vec<_>>()).unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::testutil::*;
    use super::*;

    #[test]
    fn changes_and_log() {
        let d = tempfile::tempdir().unwrap();
        let r = repo(d.path());
        std::fs::write(d.path().join("a.tex"), "one\n").unwrap();
        commit_all(&r, "first");
        std::fs::write(d.path().join("a.tex"), "two\n").unwrap();
        std::fs::write(d.path().join("b.tex"), "new\n").unwrap();
        let st = super::diff::changes_of(&r, "HEAD", "work").unwrap();
        assert_eq!(st.len(), 2);
        assert_eq!((st[0].path.as_str(), st[0].status), ("a.tex", "modified"));
        assert_eq!((st[1].path.as_str(), st[1].status), ("b.tex", "added"));
        let log = log_of(&r, None, 0, 10).unwrap();
        assert_eq!(log.commits.len(), 1);
        assert_eq!(log.commits[0].summary, "first");
        assert!(log.commits[0].refs.contains(&"HEAD".to_string()));
        assert_eq!(log_of(&r, Some("b.tex"), 0, 10).unwrap().commits.len(), 0);
        assert_eq!(log_of(&r, Some("a.tex"), 0, 10).unwrap().commits.len(), 1);
    }

    #[test]
    fn repository_above_the_project_folder_is_found_and_scoped() {
        let d = tempfile::tempdir().unwrap();
        let top = repo(d.path());
        std::fs::create_dir_all(d.path().join("praca/rozdzialy")).unwrap();
        std::fs::write(d.path().join("praca/main.tex"), "a\n").unwrap();
        std::fs::write(d.path().join("poza.txt"), "x\n").unwrap();
        commit_all(&top, "first");
        std::fs::write(d.path().join("praca/main.tex"), "b\n").unwrap();
        std::fs::write(d.path().join("praca/rozdzialy/r1.tex"), "new\n").unwrap();
        std::fs::write(d.path().join("poza.txt"), "changed\n").unwrap();

        let sub = d.path().join("praca");
        let r = discover(&sub).expect("repo two levels up");
        assert_eq!(r.prefix, "praca/");
        let paths: Vec<_> = super::diff::changes_of(&r, "HEAD", "work").unwrap().into_iter().map(|f| f.path).collect();
        assert_eq!(paths, ["main.tex", "rozdzialy/r1.tex"]);
        assert_eq!(log_of(&r, None, 0, 10).unwrap().commits.len(), 1);
        assert_eq!(log_of(&r, Some("main.tex"), 0, 10).unwrap().commits.len(), 1);

        assert!(discover(&std::env::temp_dir().join("nonexistent-xyz")).is_none());
    }

    #[test]
    fn empty_repo_has_no_log() {
        let d = tempfile::tempdir().unwrap();
        let r = repo(d.path());
        assert!(log_of(&r, None, 0, 10).unwrap().commits.is_empty());
        let i = info(d.path());
        assert!(i.is_repo && i.head.is_none());
    }
}
