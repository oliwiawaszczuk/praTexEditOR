//! Numbered chapter folder: `main.tex` has a line `%% ROZDZIAŁY content` and the editor keeps
//! the `\include` lines below it (up to `%% /ROZDZIAŁY`) equal to the `.tex` files of that folder
//! in name order (`01_`, `02_`, … ; `10` after `9`). Reordering, adding and deleting files renumbers
//! the names, so the block never needs hand-editing. A plain block of LaTeX stays in `main.tex`:
//! any engine, export and `\includeonly` previews work with it unchanged.
//!
//! A chapter file `02_Podstawy.tex` with a folder `02_Podstawy/` next to it gets the same for the
//! folder's files: a `%% PODROZDZIAŁY` block of `\input` lines at the end of the chapter file (added
//! when the folder has files). The folder follows the file when it is renumbered. Folders nest.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, State};

use crate::core::{err, CmdResult};
use crate::fs::{guard, text, tree::natural_cmp, watcher::FsChanged};
use crate::projects::registry::{Project, Projects};

const MARKER: &str = "%% ROZDZIAŁY";
const END: &str = "%% /ROZDZIAŁY";
const SUB_MARKER: &str = "%% PODROZDZIAŁY";
const SUB_END: &str = "%% /PODROZDZIAŁY";

/// What `render` writes: the marker pair and the TeX command of one block.
struct Block {
    marker: &'static str,
    end: &'static str,
    cmd: &'static str,
    /// Add the block at the end of the file when it has none yet.
    append: bool,
}

const TOP: Block = Block { marker: MARKER, end: END, cmd: "include", append: false };
const SUB: Block = Block { marker: SUB_MARKER, end: SUB_END, cmd: "input", append: true };

/// Folder named on the marker line, as written (relative to the main file's folder).
pub fn marker_dir(main_text: &str) -> Option<String> {
    main_text.lines().find_map(|l| {
        let rest = l.trim().strip_prefix(MARKER)?;
        let d = rest.trim().trim_start_matches("./").trim_end_matches('/').to_string();
        (!d.is_empty() && !d.contains("..") && !Path::new(&d).is_absolute()).then_some(d)
    })
}

/// `.tex` files of `dir` in chapter order.
pub fn files(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
                .map(|e| e.path())
                .filter(|p| {
                    let n = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                    n.ends_with(".tex") && !n.starts_with('.')
                })
                .collect()
        })
        .unwrap_or_default();
    v.sort_by(|a, b| natural_cmp(&a.to_string_lossy(), &b.to_string_lossy()));
    v
}

fn include_line(cmd: &str, rel: &str) -> Result<String, String> {
    if rel.chars().any(|c| matches!(c, '%' | '#' | '\\' | '{' | '}' | '~' | '$' | '^' | '&')) {
        return Err(format!("Nazwa pliku „{rel}” ma znak, którego TeX nie przyjmie w \\{cmd} — zmień nazwę"));
    }
    Ok(format!("\\{cmd}{{{rel}}}"))
}

/// `main_text` with the block rewritten; None when it already matches (or has no marker).
fn render(main_text: &str, b: &Block, dir: &str, names: &[String]) -> Result<Option<String>, String> {
    let crlf = main_text.contains("\r\n");
    let src = main_text.replace("\r\n", "\n");
    let mut lines: Vec<&str> = src.split('\n').collect();
    let mut owned;
    let start = match lines.iter().position(|l| l.trim().starts_with(b.marker)) {
        Some(i) => i,
        None if b.append && !names.is_empty() => {
            // Marker after the last text line, blank line before it.
            owned = src.trim_end().to_string();
            owned.push_str(&format!("\n\n{}\n", b.marker));
            lines = owned.split('\n').collect();
            lines.len() - 2
        }
        None => return Ok(None),
    };
    let end = lines[start + 1..].iter().position(|l| l.trim() == b.end).map(|i| start + 1 + i);
    let mut out: Vec<String> = lines[..=start].iter().map(|s| s.to_string()).collect();
    for n in names {
        out.push(include_line(b.cmd, &format!("{dir}/{n}"))?);
    }
    out.push(b.end.to_string());
    out.extend(lines[end.map_or(start + 1, |e| e + 1)..].iter().map(|s| s.to_string()));
    let mut new = out.join("\n");
    if new == src {
        return Ok(None);
    }
    if crlf {
        new = new.replace('\n', "\r\n");
    }
    Ok(Some(new))
}

/// One folder kept in sync: its files are listed in `host` (the main file, or a chapter file).
struct Managed {
    dir: PathBuf,
    host: PathBuf,
    /// Folder relative to the main file's folder, as `\include`/`\input` want it.
    rel: String,
    top: bool,
}

/// The top folder of the marker plus, below it, every folder named like a chapter file.
fn managed(project: &Project) -> Vec<Managed> {
    let Some(main) = project.main.clone() else { return Vec::new() };
    let Some(base) = main.parent().map(Path::to_path_buf) else { return Vec::new() };
    let Ok(src) = std::fs::read_to_string(&main) else { return Vec::new() };
    let Some(rel) = marker_dir(&src) else { return Vec::new() };
    let top = base.join(&rel);
    if !top.is_dir() {
        return Vec::new();
    }
    let mut out = vec![Managed { dir: top.clone(), host: main, rel, top: true }];
    let mut i = 0;
    while i < out.len() && out.len() < 64 {
        let (dir, rel) = (out[i].dir.clone(), out[i].rel.clone());
        for f in files(&dir) {
            let Some(stem) = f.file_stem().map(|s| s.to_string_lossy().into_owned()) else { continue };
            let sub = dir.join(&stem);
            if sub.is_dir() {
                out.push(Managed { dir: sub, host: f, rel: format!("{rel}/{stem}"), top: false });
            }
        }
        i += 1;
    }
    out
}

fn sync_one(m: &Managed) -> Result<bool, String> {
    let names: Vec<String> = files(&m.dir)
        .iter()
        .filter_map(|p| p.file_stem().map(|s| s.to_string_lossy().into_owned()))
        .collect();
    let text::Read::Text { text: old, crlf, bom, .. } = text::read(&m.host, None).map_err(err)? else {
        return Ok(false);
    };
    let Some(new) = render(&old, if m.top { &TOP } else { &SUB }, &m.rel, &names)? else {
        return Ok(false);
    };
    text::write(&m.host, &new, crlf, bom).map_err(err)?;
    Ok(true)
}

/// Rewrite the blocks in `main.tex` and the chapter files if their folders no longer match.
pub fn sync(project: &Project) -> Result<bool, String> {
    let mut any = false;
    for m in managed(project) {
        any |= sync_one(&m)?;
    }
    Ok(any)
}

/// Watcher hook: any burst may have changed a folder (or the marker line itself).
pub fn on_change(app: &AppHandle, change: &FsChanged) {
    let Ok(project) = app.state::<Projects>().get(&change.pid) else {
        return;
    };
    if let Err(e) = sync(&project) {
        eprintln!("[pratex] chapters: {e}");
    }
}

/// "03_Węgiel.tex" → ("Węgiel"); a name without a number keeps its whole stem.
fn title_of(name: &str) -> String {
    let stem = name.strip_suffix(".tex").unwrap_or(name);
    let rest = stem.trim_start_matches(|c: char| c.is_ascii_digit());
    if rest.len() == stem.len() {
        return stem.to_string();
    }
    rest.trim_start_matches(['_', '-', ' ']).to_string()
}

fn numbered(i: usize, width: usize, title: &str) -> String {
    if title.is_empty() {
        format!("{i:0width$}.tex")
    } else {
        format!("{i:0width$}_{title}.tex")
    }
}

/// Renames `moves` without clashes: everything goes through a hidden temporary name first.
fn apply(moves: &[(PathBuf, PathBuf)]) -> std::io::Result<()> {
    // Checked up front: a half-done renumbering would leave hidden temporary names behind.
    for (_, to) in moves {
        if to.exists() && !moves.iter().any(|(from, _)| from == to) {
            return Err(std::io::Error::other(format!("„{}” już istnieje", to.file_name().unwrap_or_default().to_string_lossy())));
        }
    }
    let mut mid = Vec::new();
    for (i, (from, _)) in moves.iter().enumerate() {
        let tmp = from.with_file_name(format!(".{i}.pratex-renumber"));
        std::fs::rename(from, &tmp)?;
        mid.push(tmp);
    }
    for (tmp, (_, to)) in mid.iter().zip(moves) {
        std::fs::rename(tmp, to)?;
    }
    Ok(())
}

/// Number the files of `dir` 1..N in `order` (files missing from it follow in name order).
/// Returns (from, to) for every file whose name changed.
pub fn renumber(dir: &Path, order: &[PathBuf]) -> std::io::Result<Vec<(PathBuf, PathBuf)>> {
    let current = files(dir);
    let mut list: Vec<PathBuf> = order.iter().filter(|p| current.contains(p)).cloned().collect();
    list.dedup();
    for p in &current {
        if !list.contains(p) {
            list.push(p.clone());
        }
    }
    let width = list.len().to_string().len().max(2);
    let moves: Vec<(PathBuf, PathBuf)> = list
        .iter()
        .enumerate()
        .filter_map(|(i, p)| {
            let name = p.file_name()?.to_string_lossy().into_owned();
            let to = dir.join(numbered(i + 1, width, &title_of(&name)));
            (to != *p).then(|| (p.clone(), to))
        })
        .collect();
    // A chapter's folder follows its file.
    let mut all = moves.clone();
    for (from, to) in &moves {
        let (fd, td) = (from.with_extension(""), to.with_extension(""));
        if fd.is_dir() {
            all.push((fd, td));
        }
    }
    // Two files with the same title cannot collide: the numbers differ.
    apply(&all)?;
    Ok(all)
}

/// The managed folder `dir` of the project (it must be one the markers declare).
fn managed_dir(reg: &Projects, pid: &str, dir: &Path) -> CmdResult<(Project, PathBuf)> {
    let p = reg.get(pid)?;
    let dir = guard::inside(&p, dir)?;
    if !managed(&p).iter().any(|m| m.dir == dir) {
        return Err("To nie jest numerowany folder (linia „%% ROZDZIAŁY content” w pliku głównym)".into());
    }
    Ok((p, dir))
}

/// Absolute paths of the numbered folders: the declared one and the chapter folders below it.
#[tauri::command]
pub fn chapters_info(reg: State<'_, Projects>, pid: String) -> CmdResult<Vec<PathBuf>> {
    let p = reg.get(&pid)?;
    Ok(managed(&p).into_iter().filter_map(|m| guard::inside(&p, &m.dir).ok()).collect())
}

/// Renumber after a drag / delete / rename. `order`: the wanted order (None = as named now).
/// Returns every (from, to) rename, chapter folders included.
#[tauri::command]
pub fn chapters_renumber(reg: State<'_, Projects>, pid: String, dir: PathBuf, order: Option<Vec<PathBuf>>) -> CmdResult<Vec<(PathBuf, PathBuf)>> {
    let (p, dir) = managed_dir(&reg, &pid, &dir)?;
    let order = order
        .unwrap_or_default()
        .iter()
        .map(|x| guard::inside(&p, x))
        .collect::<CmdResult<Vec<_>>>()?;
    renumber(&dir, &order).map_err(err)
}

/// Undo of a renumbering: the inverse moves, applied in one go.
#[tauri::command]
pub fn chapters_apply(reg: State<'_, Projects>, pid: String, dir: PathBuf, moves: Vec<(PathBuf, PathBuf)>) -> CmdResult<()> {
    let (p, dir) = managed_dir(&reg, &pid, &dir)?;
    for (a, b) in &moves {
        if guard::inside(&p, a)?.parent() != Some(dir.as_path()) || guard::inside(&p, b)?.parent() != Some(dir.as_path()) {
            return Err("Ścieżka jest poza numerowanym folderem".into());
        }
        if !a.exists() {
            return Err("Plik zmienił się w międzyczasie — nie da się cofnąć".into());
        }
    }
    apply(&moves).map_err(err)
}

/// New empty chapter at the end: `NN_nowy.tex`.
#[tauri::command]
pub fn chapters_new(reg: State<'_, Projects>, pid: String, dir: PathBuf) -> CmdResult<PathBuf> {
    let (_, dir) = managed_dir(&reg, &pid, &dir)?;
    let all = files(&dir);
    let top = all
        .iter()
        .filter_map(|p| {
            let n = p.file_name()?.to_string_lossy().into_owned();
            let d: String = n.chars().take_while(char::is_ascii_digit).collect();
            d.parse::<usize>().ok()
        })
        .max()
        .unwrap_or(0)
        .max(all.len());
    let path = dir.join(numbered(top + 1, (top + 1).to_string().len().max(2), "nowy"));
    std::fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(err)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(d: &Path) -> Vec<String> {
        files(d).iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect()
    }

    #[test]
    fn marker_line() {
        assert_eq!(marker_dir("a\n%% ROZDZIAŁY content\nb").as_deref(), Some("content"));
        assert_eq!(marker_dir("%% ROZDZIAŁY ./rozdzialy/\n").as_deref(), Some("rozdzialy"));
        assert_eq!(marker_dir("%% ROZDZIAŁY\n"), None);
        assert_eq!(marker_dir("%% ROZDZIAŁY ../x\n"), None);
        assert_eq!(marker_dir("x"), None);
    }

    #[test]
    fn block_is_rewritten_once() {
        let names = vec!["01_a".to_string(), "02_b".to_string()];
        let src = "\\a\n%% ROZDZIAŁY content\n\\include{content/old}\n%% /ROZDZIAŁY\n\\b\n";
        let new = render(src, &TOP, "content", &names).unwrap().unwrap();
        assert_eq!(new, "\\a\n%% ROZDZIAŁY content\n\\include{content/01_a}\n\\include{content/02_b}\n%% /ROZDZIAŁY\n\\b\n");
        assert_eq!(render(&new, &TOP, "content", &names).unwrap(), None);
        // Only the marker: the end line is added.
        let bare = render("x\n%% ROZDZIAŁY content\ny", &TOP, "content", &names).unwrap().unwrap();
        assert_eq!(bare, "x\n%% ROZDZIAŁY content\n\\include{content/01_a}\n\\include{content/02_b}\n%% /ROZDZIAŁY\ny");
        assert_eq!(render("no marker", &TOP, "content", &names).unwrap(), None);
        assert!(render("%% ROZDZIAŁY c\n", &TOP, "c", &["a%b".to_string()]).is_err());
        assert!(render("%% ROZDZIAŁY c\r\n", &TOP, "c", &names).unwrap().unwrap().contains("\r\n\\include{c/01_a}\r\n"));
    }

    #[test]
    fn chapter_block_is_appended_and_folder_follows() {
        let names = vec!["01_a".to_string()];
        let new = render("\\section{P}\n", &SUB, "content/02_P", &names).unwrap().unwrap();
        assert_eq!(new, "\\section{P}\n\n%% PODROZDZIAŁY\n\\input{content/02_P/01_a}\n%% /PODROZDZIAŁY\n");
        assert_eq!(render(&new, &SUB, "content/02_P", &names).unwrap(), None);
        assert_eq!(render("\\section{P}\n", &SUB, "content/02_P", &[]).unwrap(), None);

        let d = tempfile::tempdir().unwrap();
        for n in ["01_a.tex", "02_P.tex", "03_c.tex"] {
            std::fs::write(d.path().join(n), n).unwrap();
        }
        std::fs::create_dir(d.path().join("02_P")).unwrap();
        std::fs::write(d.path().join("02_P/01_x.tex"), "x").unwrap();
        let p = |n: &str| d.path().join(n);
        let moves = renumber(d.path(), &[p("02_P.tex"), p("01_a.tex"), p("03_c.tex")]).unwrap();
        assert_eq!(names_in(d.path()), ["01_P.tex", "02_a.tex", "03_c.tex"]);
        assert!(p("01_P/01_x.tex").is_file() && !p("02_P").exists());
        assert!(moves.contains(&(p("02_P"), p("01_P"))));
    }

    fn names_in(d: &Path) -> Vec<String> {
        names(d)
    }

    #[test]
    fn renumbering() {
        let d = tempfile::tempdir().unwrap();
        for n in ["01_a.tex", "02_b.tex", "03_c.tex", "04_d.tex", "notes.txt"] {
            std::fs::write(d.path().join(n), n).unwrap();
        }
        let p = |n: &str| d.path().join(n);
        // 02 dragged below 04.
        let moves = renumber(d.path(), &[p("01_a.tex"), p("03_c.tex"), p("04_d.tex"), p("02_b.tex")]).unwrap();
        assert_eq!(moves.len(), 3);
        assert_eq!(names(d.path()), ["01_a.tex", "02_c.tex", "03_d.tex", "04_b.tex"]);
        assert_eq!(std::fs::read_to_string(p("04_b.tex")).unwrap(), "02_b.tex");
        // Gap after a delete closes; undo through the inverse moves.
        std::fs::remove_file(p("02_c.tex")).unwrap();
        let moves = renumber(d.path(), &[]).unwrap();
        assert_eq!(names(d.path()), ["01_a.tex", "02_d.tex", "03_b.tex"]);
        let back: Vec<_> = moves.iter().map(|(a, b)| (b.clone(), a.clone())).collect();
        apply(&back).unwrap();
        assert_eq!(names(d.path()), ["01_a.tex", "03_d.tex", "04_b.tex"]);
        // Unnumbered file joins at the end; 10 sorts after 9.
        std::fs::write(p("zz.tex"), "").unwrap();
        renumber(d.path(), &[]).unwrap();
        assert_eq!(names(d.path()), ["01_a.tex", "02_d.tex", "03_b.tex", "04_zz.tex"]);
    }
}
