//! Writing commands: init, discard (whole files and single hunks) and restore from a
//! commit. There is deliberately no commit / stage here — recording history happens
//! outside the app. Anything that overwrites a working file sends the old content to the
//! trash first, so nothing is lost silently.

use std::path::{Component, Path, PathBuf};

use git2::{build::CheckoutBuilder, ApplyLocation, ApplyOptions, Repository};
use tauri::{AppHandle, Manager};

use super::{discover, git_err, open, open_in, Repo};
use crate::core::{err, CmdResult};
use crate::fs::guard;
use crate::projects::registry::Projects;

fn check_rel(p: &str) -> CmdResult<&Path> {
    let path = Path::new(p);
    let bad = p.is_empty() || path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir | Component::Prefix(_)));
    if bad {
        return Err("Niepoprawna ścieżka".into());
    }
    Ok(path)
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> CmdResult<T> + Send + 'static) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(err)?
}

#[tauri::command]
pub async fn git_init(app: AppHandle, pid: String, root: PathBuf) -> CmdResult<()> {
    blocking(move || {
        let project = app.state::<Projects>().get(&pid)?;
        let root = guard::canonical(&root)?;
        if !guard::is_root(&project, &root) {
            return Err("To nie jest folder główny projektu".into());
        }
        if discover(&root).is_some() {
            return Err("Ten folder jest już w repozytorium Git".into());
        }
        let repo = Repository::init(&root).map_err(git_err)?;
        // TeX by-products are not worth versioning; only written when the user has no ignore file.
        let ignore = root.join(".gitignore");
        if !ignore.exists() {
            let body = "*.aux\n*.log\n*.synctex.gz\n*.fdb_latexmk\n*.fls\n*.out\n*.toc\n*.bbl\n*.blg\n*.bcf\n*.run.xml\n.DS_Store\n";
            std::fs::write(&ignore, body).map_err(err)?;
        }
        drop(repo);
        Ok(())
    })
    .await
}

/// Revert hunk number `n` of the file's changes against HEAD (3-line-context numbering,
/// the same the UI shows).
fn discard_hunk_of(repo: &Repo, path: &str, n: usize) -> CmdResult<()> {
    let path = &repo.add(path);
    check_rel(path)?;
    let mut o = git2::DiffOptions::new();
    o.context_lines(3).pathspec(path).reverse(true);
    let tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let diff = repo.diff_tree_to_workdir(tree.as_ref(), Some(&mut o)).map_err(git_err)?;
    let mut seen = 0usize;
    let mut opts = ApplyOptions::new();
    opts.hunk_callback(|_| {
        seen += 1;
        seen == n + 1
    });
    repo.apply(&diff, ApplyLocation::WorkDir, Some(&mut opts)).map_err(git_err)
}

/// Throw away one block of changes from the file (the UI asks for confirmation).
#[tauri::command]
pub async fn git_discard_hunk(app: AppHandle, pid: String, root: PathBuf, path: String, hunk: usize) -> CmdResult<()> {
    blocking(move || discard_hunk_of(&open(&app, &pid, &root)?, &path, hunk)).await
}

/// Bring the given files back to the last commit: changed / deleted files return to the
/// committed version, new files disappear. The content they had goes to the trash.
fn discard_files(repo: &Repo, paths: &[String]) -> CmdResult<()> {
    let work = repo.workdir_path();
    let head = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let tree = head.as_ref().and_then(|c| c.tree().ok());
    for p in paths {
        let full = repo.add(p);
        let rel = check_rel(&full)?;
        let abs = work.join(rel);
        if abs.symlink_metadata().is_ok() {
            trash::delete(&abs).map_err(|e| format!("Nie udało się przenieść do kosza: {e}"))?;
        }
        let committed = tree.as_ref().is_some_and(|t| t.get_path(rel).is_ok());
        if let (true, Some(c)) = (committed, &head) {
            // Index back to HEAD, then the file from the index.
            repo.reset_default(Some(c.as_object()), [rel]).map_err(git_err)?;
            let mut cb = CheckoutBuilder::new();
            cb.path(rel).force();
            repo.checkout_index(None, Some(&mut cb)).map_err(git_err)?;
        } else {
            let mut index = repo.index().map_err(git_err)?;
            let _ = index.remove_path(rel);
            index.write().map_err(git_err)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn git_discard(app: AppHandle, pid: String, root: PathBuf, paths: Vec<String>) -> CmdResult<()> {
    blocking(move || discard_files(&open(&app, &pid, &root)?, &paths)).await
}

/// Put the version of `path` from `commit` into the working tree. Whatever was there
/// goes to the trash first.
#[tauri::command]
pub async fn git_restore_from(app: AppHandle, pid: String, root: PathBuf, commit: String, path: String) -> CmdResult<()> {
    blocking(move || {
        let project = app.state::<Projects>().get(&pid)?;
        let repo = open_in(&project, &root)?;
        let full = repo.add(&path);
        let rel = check_rel(&full)?;
        let c = repo.revparse_single(&commit).and_then(|o| o.peel_to_commit()).map_err(|_| "Nie ma takiego commita".to_string())?;
        let entry = c.tree().map_err(git_err)?.get_path(rel).map_err(|_| "Tego pliku nie było w wybranym commicie".to_string())?;
        let blob = entry.to_object(&repo).and_then(|o| o.peel_to_blob()).map_err(git_err)?;
        let abs = guard::inside(&project, &repo.workdir_path().join(rel))?;
        if abs.symlink_metadata().is_ok() {
            trash::delete(&abs).map_err(|e| format!("Nie udało się przenieść do kosza: {e}"))?;
        }
        if let Some(dir) = abs.parent() {
            std::fs::create_dir_all(dir).map_err(err)?;
        }
        let tmp = abs.with_extension("pratex~");
        std::fs::write(&tmp, blob.content()).map_err(err)?;
        std::fs::rename(&tmp, &abs).map_err(err)
    })
    .await
}

#[cfg(test)]
pub(crate) mod tests {
    use super::super::testutil::*;
    use super::*;

    fn write(d: &Path, n: &str, s: &str) {
        std::fs::write(d.join(n), s).unwrap();
    }

    #[test]
    fn discard_hunk_reverts_only_that_block() {
        let d = tempfile::tempdir().unwrap();
        let r = repo(d.path());
        let base: String = (1..=30).map(|i| format!("l{i}\n")).collect();
        write(d.path(), "a.tex", &base);
        commit_all(&r, "first");
        write(d.path(), "a.tex", &base.replace("l2\n", "TWO\n").replace("l28\n", "TWENTY8\n"));
        discard_hunk_of(&r, "a.tex", 0).unwrap();
        let now = std::fs::read_to_string(d.path().join("a.tex")).unwrap();
        assert!(now.contains("l2\n") && !now.contains("TWO") && now.contains("TWENTY8"));
    }

    #[test]
    fn discard_hunk_also_works_for_a_change_staged_elsewhere() {
        let d = tempfile::tempdir().unwrap();
        let r = repo(d.path());
        write(d.path(), "a.tex", "one\ntwo\n");
        commit_all(&r, "first");
        write(d.path(), "a.tex", "ONE\ntwo\n");
        let mut idx = r.index().unwrap();
        idx.add_path(Path::new("a.tex")).unwrap();
        idx.write().unwrap();
        discard_hunk_of(&r, "a.tex", 0).unwrap();
        assert_eq!(std::fs::read_to_string(d.path().join("a.tex")).unwrap(), "one\ntwo\n");
    }

    #[test]
    #[ignore = "moves files to the real system trash"]
    fn discard_files_restores_deletes_and_forgets_new() {
        let d = tempfile::tempdir().unwrap();
        let r = repo(d.path());
        write(d.path(), "keep.tex", "orig\n");
        write(d.path(), "gone.tex", "was here\n");
        commit_all(&r, "first");
        write(d.path(), "keep.tex", "edited\n");
        std::fs::remove_file(d.path().join("gone.tex")).unwrap();
        write(d.path(), "new.tex", "fresh\n");
        let mut idx = r.index().unwrap();
        idx.add_path(Path::new("new.tex")).unwrap();
        idx.write().unwrap();
        discard_files(&r, &["keep.tex".into(), "gone.tex".into(), "new.tex".into()]).unwrap();
        assert_eq!(std::fs::read_to_string(d.path().join("keep.tex")).unwrap(), "orig\n");
        assert_eq!(std::fs::read_to_string(d.path().join("gone.tex")).unwrap(), "was here\n");
        assert!(!d.path().join("new.tex").exists());
        let left = super::super::diff::changes_of(&r, "HEAD", "work").unwrap();
        assert!(left.is_empty(), "{left:?}");
    }

    #[test]
    fn rejects_escaping_paths() {
        assert!(check_rel("../x").is_err());
        assert!(check_rel("/etc/passwd").is_err());
        assert!(check_rel("a/b.tex").is_ok());
    }
}
