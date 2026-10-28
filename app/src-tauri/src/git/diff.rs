//! Diffs between any two states: a commit, the index ("index"), the working tree ("work"),
//! HEAD ("HEAD") or nothing ("root"). The list of changed files and the hunks of one file
//! are separate calls, so a big commit never ships every line to the webview.

use std::path::PathBuf;

use git2::{Delta, Diff, DiffOptions, Patch, Repository, Tree};
use serde::Serialize;
use tauri::AppHandle;

use super::{git_err, open, rel, Repo};
use crate::core::{err, CmdResult};

/// A single file stops being shown line by line past this many lines.
const MAX_LINES: usize = 20_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSummary {
    pub path: String,
    pub old_path: Option<String>,
    pub status: &'static str,
    pub binary: bool,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct Line {
    /// ' ', '+' or '-'.
    pub kind: char,
    pub old: Option<u32>,
    pub new: Option<u32>,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    pub header: String,
    pub old_start: u32,
    pub new_start: u32,
    pub lines: Vec<Line>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    #[serde(flatten)]
    pub summary: FileSummary,
    pub hunks: Vec<Hunk>,
    pub truncated: bool,
}

fn tree_of<'r>(repo: &'r Repository, spec: &str) -> CmdResult<Option<Tree<'r>>> {
    match spec {
        "root" => Ok(None),
        // Before the first commit HEAD is an empty tree.
        "HEAD" => Ok(repo.head().ok().and_then(|h| h.peel_to_tree().ok())),
        id => {
            let obj = repo.revparse_single(id).map_err(|_| "Nie ma takiego commita".to_string())?;
            obj.peel_to_tree().map(Some).map_err(git_err)
        }
    }
}

pub(crate) fn make_diff<'r>(repo: &'r Repo, from: &str, to: &str, path: Option<&str>, context: u32) -> CmdResult<Diff<'r>> {
    let mut o = DiffOptions::new();
    o.context_lines(context)
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .show_untracked_content(true)
        .include_typechange(true);
    if let Some(p) = repo.spec(path) {
        o.pathspec(p);
    }
    let mut diff = match (from, to) {
        ("index", "work") => repo.diff_index_to_workdir(None, Some(&mut o)),
        ("index", _) => return Err("Niewspierane porównanie".into()),
        (_, "index") => repo.diff_tree_to_index(tree_of(repo, from)?.as_ref(), None, Some(&mut o)),
        (_, "work") => repo.diff_tree_to_workdir_with_index(tree_of(repo, from)?.as_ref(), Some(&mut o)),
        _ => repo.diff_tree_to_tree(tree_of(repo, from)?.as_ref(), tree_of(repo, to)?.as_ref(), Some(&mut o)),
    }
    .map_err(git_err)?;
    diff.find_similar(None).map_err(git_err)?;
    Ok(diff)
}

fn status_name(s: Delta) -> &'static str {
    match s {
        Delta::Added | Delta::Untracked => "added",
        Delta::Deleted => "deleted",
        Delta::Renamed | Delta::Copied => "renamed",
        Delta::Typechange => "typechange",
        _ => "modified",
    }
}

fn summarize(repo: &Repo, diff: &Diff, idx: usize, patch: Option<&Patch>) -> Option<FileSummary> {
    let d = diff.get_delta(idx)?;
    if d.status() == Delta::Unmodified || d.status() == Delta::Ignored {
        return None;
    }
    let local = |p: &std::path::Path| {
        let r = rel(p);
        repo.strip(&r).map(str::to_string).unwrap_or(r)
    };
    let path = d.new_file().path().or_else(|| d.old_file().path()).map(local)?;
    // OS litter (the file tree hides it too); never a change worth showing.
    if matches!(path.rsplit('/').next(), Some(".DS_Store" | "Thumbs.db" | "desktop.ini")) {
        return None;
    }
    let old = (d.status() == Delta::Renamed || d.status() == Delta::Copied).then(|| d.old_file().path().map(local)).flatten();
    let (add, del) = patch.and_then(|p| p.line_stats().ok()).map(|(_, a, d)| (a as u32, d as u32)).unwrap_or((0, 0));
    Some(FileSummary { path, old_path: old, status: status_name(d.status()), binary: d.flags().is_binary() || patch.is_none(), additions: add, deletions: del })
}

pub(crate) fn changes_of(repo: &Repo, from: &str, to: &str) -> CmdResult<Vec<FileSummary>> {
    let diff = make_diff(repo, from, to, None, 0)?;
    let mut out = Vec::new();
    for i in 0..diff.deltas().len() {
        let patch = Patch::from_diff(&diff, i).map_err(git_err)?;
        if let Some(s) = summarize(repo, &diff, i, patch.as_ref()) {
            out.push(s);
        }
    }
    out.sort_by_key(|f| f.path.to_lowercase());
    Ok(out)
}

fn file_diff_of(repo: &Repo, from: &str, to: &str, path: &str, context: u32) -> CmdResult<FileDiff> {
    let diff = make_diff(repo, from, to, Some(path), context)?;
    for i in 0..diff.deltas().len() {
        let Some(d) = diff.get_delta(i) else { continue };
        let p = d.new_file().path().or_else(|| d.old_file().path()).map(rel);
        if p.as_deref() != Some(repo.add(path).as_str()) {
            continue;
        }
        let patch = Patch::from_diff(&diff, i).map_err(git_err)?;
        let Some(summary) = summarize(repo, &diff, i, patch.as_ref()) else { break };
        let mut hunks = Vec::new();
        let mut total = 0usize;
        let mut truncated = false;
        if let Some(patch) = &patch {
            'outer: for h in 0..patch.num_hunks() {
                let (hunk, n) = patch.hunk(h).map_err(git_err)?;
                let mut lines = Vec::with_capacity(n);
                for l in 0..n {
                    let line = patch.line_in_hunk(h, l).map_err(git_err)?;
                    let kind = line.origin();
                    if !matches!(kind, ' ' | '+' | '-') {
                        continue;
                    }
                    if total >= MAX_LINES {
                        truncated = true;
                        hunks.push(Hunk { header: String::from_utf8_lossy(hunk.header()).trim_end().to_string(), old_start: hunk.old_start(), new_start: hunk.new_start(), lines });
                        break 'outer;
                    }
                    total += 1;
                    let text = String::from_utf8_lossy(line.content());
                    lines.push(Line { kind, old: line.old_lineno(), new: line.new_lineno(), text: text.trim_end_matches(['\n', '\r']).to_string() });
                }
                hunks.push(Hunk { header: String::from_utf8_lossy(hunk.header()).trim_end().to_string(), old_start: hunk.old_start(), new_start: hunk.new_start(), lines });
            }
        }
        return Ok(FileDiff { summary, hunks, truncated });
    }
    Err("Brak różnic w tym pliku".into())
}

/// Files that differ between `from` and `to` (see the module doc for the names).
#[tauri::command]
pub async fn git_changes(app: AppHandle, pid: String, root: PathBuf, from: String, to: String) -> CmdResult<Vec<FileSummary>> {
    tauri::async_runtime::spawn_blocking(move || changes_of(&open(&app, &pid, &root)?, &from, &to))
        .await
        .map_err(err)?
}

/// Lines of one file; `context` = unchanged lines around each change (large = whole file).
#[tauri::command]
pub async fn git_file_diff(app: AppHandle, pid: String, root: PathBuf, from: String, to: String, path: String, context: u32) -> CmdResult<FileDiff> {
    tauri::async_runtime::spawn_blocking(move || file_diff_of(&open(&app, &pid, &root)?, &from, &to, &path, context.min(100_000)))
        .await
        .map_err(err)?
}

#[cfg(test)]
pub(crate) mod tests {
    use super::super::testutil::*;
    use super::*;

    #[test]
    fn work_vs_head_and_commit_ranges() {
        let d = tempfile::tempdir().unwrap();
        let r = repo(d.path());
        std::fs::write(d.path().join("a.tex"), "one\ntwo\nthree\n").unwrap();
        let c1 = commit_all(&r, "first");
        std::fs::write(d.path().join("a.tex"), "one\n2\nthree\nfour\n").unwrap();
        std::fs::write(d.path().join("n.tex"), "fresh\n").unwrap();
        let c2 = commit_all(&r, "second");
        std::fs::write(d.path().join("a.tex"), "ONE\n2\nthree\nfour\n").unwrap();

        let work = changes_of(&r, "HEAD", "work").unwrap();
        assert_eq!(work.len(), 1);
        assert_eq!((work[0].additions, work[0].deletions), (1, 1));

        let range = changes_of(&r, &c1.to_string(), &c2.to_string()).unwrap();
        assert_eq!(range.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), ["a.tex", "n.tex"]);
        assert_eq!(range[1].status, "added");

        // First commit against nothing.
        let first = changes_of(&r, "root", &c1.to_string()).unwrap();
        assert_eq!(first.len(), 1);

        let fd = file_diff_of(&r, &c1.to_string(), "work", "a.tex", 3).unwrap();
        assert_eq!(fd.hunks.len(), 1);
        let kinds: String = fd.hunks[0].lines.iter().map(|l| l.kind).collect();
        assert!(kinds.contains('+') && kinds.contains('-'));
        assert_eq!(fd.hunks[0].lines[0].old, Some(1));
    }

    #[test]
    fn untracked_file_shows_its_lines_and_binary_is_flagged() {
        let d = tempfile::tempdir().unwrap();
        let r = repo(d.path());
        std::fs::write(d.path().join("a.tex"), "x\n").unwrap();
        commit_all(&r, "first");
        std::fs::write(d.path().join("new.tex"), "l1\nl2\n").unwrap();
        std::fs::write(d.path().join("img.bin"), [0u8, 1, 2, 0, 255, 0]).unwrap();
        let fd = file_diff_of(&r, "HEAD", "work", "new.tex", 3).unwrap();
        assert_eq!(fd.summary.status, "added");
        assert_eq!(fd.hunks[0].lines.len(), 2);
        let list = changes_of(&r, "HEAD", "work").unwrap();
        assert!(list.iter().find(|f| f.path == "img.bin").unwrap().binary);
    }
}
