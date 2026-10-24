//! Project index (docs/02-plan.md §7): a light line scanner instead of a language server.
//! Per `.tex`: sections, labels, includes, images, word count; per `.bib`: entries.
//! Scans are cached per file by (mtime, size), so a refresh after a change re-reads only
//! the files that differ. `index_get` is pull-based (the frontend asks after `fs-changed`):
//! nothing runs in the background.
//!
//! The outline follows the include graph from the main file, i.e. print order, not file
//! by file. Without a main file every `.tex` is visited in path order.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::core::{err, CmdResult};
use crate::fs::tree::{self, Visibility};
use crate::projects::registry::{Project, Projects};

// ── Scanning ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
enum Item {
    Section { level: u8, title: String },
    Include(String),
}

#[derive(Debug, Clone, PartialEq, Default)]
struct TexScan {
    /// Sections and includes in text order: (line, item).
    items: Vec<(u32, Item)>,
    /// (key, line, context text of that line)
    labels: Vec<(String, u32, String)>,
    words: u32,
}

#[derive(Debug, Clone, PartialEq, Default)]
struct BibScan {
    entries: Vec<BibEntry>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BibEntry {
    pub key: String,
    pub kind: String,
    pub authors: String,
    pub title: String,
    pub year: String,
    pub line: u32,
}

/// The line without its comment (first `%` not escaped by a backslash).
fn strip_comment(line: &str) -> &str {
    let b = line.as_bytes();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'\\' => i += 2,
            b'%' => return &line[..i],
            _ => i += 1,
        }
    }
    line
}

/// `{...}` balanced from `s[0] == '{'`: (content, rest after the closing brace).
fn braced(s: &str) -> Option<(&str, &str)> {
    let b = s.as_bytes();
    if b.first() != Some(&b'{') {
        return None;
    }
    let mut depth = 0;
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'\\' => i += 1,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some((&s[1..i], &s[i + 1..]));
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

/// Skips an optional `[...]` argument (and spaces) before the braces.
fn skip_opt(s: &str) -> &str {
    let t = s.trim_start();
    if t.starts_with('[') {
        if let Some(end) = t.find(']') {
            return t[end + 1..].trim_start();
        }
    }
    t
}

/// Every `\name[opt]{arg}` on the line: (name, argument, rest after the argument).
fn commands(line: &str) -> Vec<(&str, &str)> {
    let mut out = Vec::new();
    let b = line.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] != b'\\' {
            i += 1;
            continue;
        }
        let start = i + 1;
        let mut j = start;
        while j < b.len() && (b[j].is_ascii_alphabetic() || b[j] == b'@') {
            j += 1;
        }
        if j == start {
            i = start + 1; // `\\`, `\%`, `\{` …
            continue;
        }
        let name = &line[start..j];
        let mut k = j;
        if k < b.len() && b[k] == b'*' {
            k += 1;
        }
        if let Some((arg, _)) = braced(skip_opt(&line[k..])) {
            out.push((name, arg));
        }
        i = j;
    }
    out
}

/// Section command → outline depth (part = 0 … paragraph = 5).
fn level_of(name: &str) -> Option<u8> {
    Some(match name {
        "part" => 0,
        "chapter" => 1,
        "section" => 2,
        "subsection" | "frametitle" => 3,
        "subsubsection" => 4,
        "paragraph" => 5,
        _ => return None,
    })
}

/// Title text for the outline: markup dropped, braces removed.
fn plain(text: &str) -> String {
    let mut out = String::new();
    let b = text.as_bytes();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'\\' => {
                let mut j = i + 1;
                while j < b.len() && b[j].is_ascii_alphabetic() {
                    j += 1;
                }
                if j == i + 1 {
                    // escaped symbol (`\&`) → the symbol
                    if let Some(c) = text[i + 1..].chars().next() {
                        out.push(c);
                        i += 1 + c.len_utf8();
                        continue;
                    }
                }
                i = j;
            }
            b'{' | b'}' | b'$' => i += 1,
            _ => {
                let c = text[i..].chars().next().unwrap();
                out.push(c);
                i += c.len_utf8();
            }
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

const NO_TEXT: &[&str] = &[
    "label", "ref", "eqref", "pageref", "autoref", "cref", "Cref", "cite", "citep", "citet", "citeauthor", "citeyear", "parencite", "textcite",
    "includegraphics", "input", "include", "subfile", "usepackage", "documentclass", "bibliography", "bibliographystyle", "addbibresource",
    "begin", "end", "newcommand", "renewcommand", "setlength", "hspace", "vspace", "url", "pagestyle", "thispagestyle",
];

/// Words of one line: command names and the arguments of reference-like commands are
/// dropped, inline math too. `in_math` carries `$` state across the line.
fn count_words(line: &str, in_math: &mut bool) -> u32 {
    let mut text = String::new();
    let b = line.as_bytes();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'\\' => {
                let mut j = i + 1;
                while j < b.len() && (b[j].is_ascii_alphabetic() || b[j] == b'@') {
                    j += 1;
                }
                if j == i + 1 {
                    i += 2; // `\\`, `\%`
                    text.push(' ');
                    continue;
                }
                let name = &line[i + 1..j];
                let mut k = j;
                if k < b.len() && b[k] == b'*' {
                    k += 1;
                }
                if NO_TEXT.contains(&name) {
                    let rest = skip_opt(&line[k..]);
                    if let Some((_, after)) = braced(rest) {
                        i = line.len() - after.len();
                        continue;
                    }
                }
                text.push(' ');
                i = k;
            }
            b'$' => {
                *in_math = !*in_math;
                text.push(' ');
                i += 1;
            }
            _ if *in_math => i += line[i..].chars().next().map_or(1, char::len_utf8),
            _ => {
                let c = line[i..].chars().next().unwrap();
                text.push(c);
                i += c.len_utf8();
            }
        }
    }
    text.split(|c: char| !(c.is_alphanumeric() || c == '\'' || c == '-' || c == '’'))
        .filter(|w| w.chars().any(char::is_alphanumeric))
        .count() as u32
}

const VERBATIM: &[&str] = &["verbatim", "verbatim*", "lstlisting", "minted", "comment"];

fn scan_tex(text: &str) -> TexScan {
    let mut out = TexScan::default();
    let mut verbatim: Option<&str> = None;
    let mut body = true; // false until \begin{document} when the file has one
    if text.contains("\\begin{document}") {
        body = false;
    }
    let mut in_math = false;
    for (n, raw) in text.lines().enumerate() {
        let line_no = n as u32 + 1;
        let line = strip_comment(raw);
        if let Some(env) = verbatim {
            if line.contains(&format!("\\end{{{env}}}")) {
                verbatim = None;
            }
            continue;
        }
        let cmds = commands(line);
        for (name, arg) in &cmds {
            match *name {
                "begin" => {
                    if *arg == "document" {
                        body = true;
                    } else if let Some(v) = VERBATIM.iter().find(|v| **v == *arg) {
                        // only when the environment is not closed on the same line
                        if !line.contains(&format!("\\end{{{v}}}")) {
                            verbatim = Some(v);
                        }
                    }
                }
                "end" if *arg == "document" => body = false,
                "label" => {
                    let ctx = plain(&raw_without_label(line, arg));
                    out.labels.push((arg.trim().to_string(), line_no, ctx.chars().take(90).collect()));
                }
                "input" | "include" | "subfile" | "subfileinclude" => out.items.push((line_no, Item::Include(arg.trim().to_string()))),
                n => {
                    if let Some(level) = level_of(n) {
                        out.items.push((line_no, Item::Section { level, title: plain(arg) }));
                    }
                }
            }
        }
        if body && verbatim.is_none() {
            out.words += count_words(line, &mut in_math);
        }
    }
    out
}

fn raw_without_label(line: &str, key: &str) -> String {
    line.replace(&format!("\\label{{{key}}}"), "")
}

// ── BibTeX ───────────────────────────────────────────────────────────────────

fn scan_bib(text: &str) -> BibScan {
    let mut entries = Vec::new();
    let b = text.as_bytes();
    let mut i = 0;
    while let Some(at) = text[i..].find('@') {
        let start = i + at;
        let line = text[..start].bytes().filter(|c| *c == b'\n').count() as u32 + 1;
        let mut j = start + 1;
        while j < b.len() && b[j].is_ascii_alphabetic() {
            j += 1;
        }
        let kind = text[start + 1..j].to_lowercase();
        let rest = text[j..].trim_start();
        let open = rest.chars().next();
        if kind.is_empty() || !matches!(open, Some('{') | Some('(')) {
            i = start + 1;
            continue;
        }
        let body_start = text.len() - rest.len();
        // Entry body: balanced braces (parentheses entries are rare; treated the same way).
        let Some((body, after)) = braced_any(&text[body_start..]) else {
            break;
        };
        i = text.len() - after.len();
        if matches!(kind.as_str(), "comment" | "string" | "preamble") {
            continue;
        }
        let Some((key, fields)) = body.split_once(',') else { continue };
        let mut e = BibEntry { key: key.trim().to_string(), kind, authors: String::new(), title: String::new(), year: String::new(), line };
        for (name, value) in bib_fields(fields) {
            match name.as_str() {
                "author" | "editor" if e.authors.is_empty() || name == "author" => e.authors = plain(&value.replace(" and ", "; ")),
                "title" => e.title = plain(&value),
                "year" => e.year = value.trim().to_string(),
                "date" if e.year.is_empty() => e.year = value.trim().chars().take(4).collect(),
                _ => {}
            }
        }
        if !e.key.is_empty() {
            entries.push(e);
        }
    }
    BibScan { entries }
}

/// `{...}` or `(...)` from the first char: (content, rest).
fn braced_any(s: &str) -> Option<(&str, &str)> {
    if s.starts_with('{') {
        return braced(s);
    }
    let end = s.find(')')?;
    Some((&s[1..end], &s[end + 1..]))
}

/// `name = {value} | "value" | 123 | macro,` pairs of an entry body.
fn bib_fields(s: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut rest = s;
    while let Some(eq) = rest.find('=') {
        let name = rest[..eq].trim_end().rsplit(|c: char| c == ',' || c.is_whitespace()).next().unwrap_or("").to_lowercase();
        let v = rest[eq + 1..].trim_start();
        let (value, after) = if v.starts_with('{') {
            match braced(v) {
                Some((c, a)) => (c.to_string(), a),
                None => break,
            }
        } else if let Some(q) = v.strip_prefix('"') {
            match q.find('"') {
                Some(end) => (q[..end].to_string(), &q[end + 1..]),
                None => break,
            }
        } else {
            let end = v.find(',').unwrap_or(v.len());
            (v[..end].trim().to_string(), &v[end..])
        };
        if !name.is_empty() {
            out.push((name, value));
        }
        rest = after;
    }
    out
}

// ── Project snapshot ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineItem {
    pub level: u8,
    pub title: String,
    pub file: PathBuf,
    pub line: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelItem {
    pub key: String,
    pub file: PathBuf,
    pub line: u32,
    pub context: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BibItem {
    #[serde(flatten)]
    pub entry: BibEntry,
    pub file: PathBuf,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub outline: Vec<OutlineItem>,
    pub labels: Vec<LabelItem>,
    pub bib: Vec<BibItem>,
    /// Words of the whole document (files reachable from the main file).
    pub words: u32,
    /// Words per file.
    pub file_words: HashMap<PathBuf, u32>,
}

enum Scan {
    Tex(Arc<TexScan>),
    Bib(Arc<BibScan>),
}

struct Cached {
    mtime: u64,
    size: u64,
    scan: Scan,
}

#[derive(Default)]
pub struct Indexes(Mutex<HashMap<String, HashMap<PathBuf, Cached>>>);

/// Try the include target relative to the main folder, the including file's folder and
/// every root, with and without `.tex`.
fn resolve(target: &str, from: &Path, project: &Project, known: &HashMap<PathBuf, Arc<TexScan>>) -> Option<PathBuf> {
    let mut bases: Vec<PathBuf> = Vec::new();
    if let Some(d) = project.main.as_ref().and_then(|m| m.parent()) {
        bases.push(d.to_path_buf());
    }
    if let Some(d) = from.parent() {
        bases.push(d.to_path_buf());
    }
    bases.extend(project.roots.iter().cloned());
    for base in bases {
        let p = base.join(target);
        for cand in [p.clone(), p.with_extension("tex"), PathBuf::from(format!("{}.tex", p.display()))] {
            if known.contains_key(&cand) {
                return Some(cand);
            }
        }
    }
    None
}

fn snapshot(project: &Project, cache: &HashMap<PathBuf, Cached>) -> Snapshot {
    let mut tex: HashMap<PathBuf, Arc<TexScan>> = HashMap::new();
    let mut snap = Snapshot::default();
    for (path, c) in cache {
        match &c.scan {
            Scan::Tex(t) => {
                tex.insert(path.clone(), t.clone());
            }
            Scan::Bib(b) => snap.bib.extend(b.entries.iter().cloned().map(|entry| BibItem { entry, file: path.clone() })),
        }
    }
    snap.bib.sort_by_key(|b| b.entry.key.to_lowercase());

    let mut order: Vec<PathBuf> = tex.keys().cloned().collect();
    order.sort();
    let roots: Vec<PathBuf> = match project.main.as_ref().filter(|m| tex.contains_key(*m)) {
        Some(m) => vec![m.clone()],
        None => order.clone(),
    };

    let mut seen: HashSet<PathBuf> = HashSet::new();
    fn visit(path: &PathBuf, tex: &HashMap<PathBuf, Arc<TexScan>>, project: &Project, seen: &mut HashSet<PathBuf>, snap: &mut Snapshot) {
        if !seen.insert(path.clone()) {
            return;
        }
        let Some(scan) = tex.get(path) else { return };
        snap.words += scan.words;
        snap.file_words.insert(path.clone(), scan.words);
        for (line, item) in &scan.items {
            match item {
                Item::Section { level, title } => snap.outline.push(OutlineItem { level: *level, title: title.clone(), file: path.clone(), line: *line }),
                Item::Include(t) => {
                    if let Some(next) = resolve(t, path, project, tex) {
                        visit(&next, tex, project, seen, snap);
                    }
                }
            }
        }
    }
    for r in &roots {
        visit(r, &tex, project, &mut seen, &mut snap);
    }
    // Files outside the graph still have words/labels (and a per-file count for the bar).
    for p in &order {
        if let Some(s) = tex.get(p) {
            snap.file_words.entry(p.clone()).or_insert(s.words);
            for (key, line, context) in &s.labels {
                snap.labels.push(LabelItem { key: key.clone(), file: p.clone(), line: *line, context: context.clone() });
            }
        }
    }
    snap
}

fn refresh(project: &Project, cache: &mut HashMap<PathBuf, Cached>) {
    let entries = tree::search(&project.roots, "", Visibility::default(), 20_000);
    let mut live: HashSet<PathBuf> = HashSet::new();
    for e in entries.into_iter().filter(|e| !e.dir) {
        let ext = e.path.extension().and_then(|x| x.to_str()).map(str::to_lowercase);
        let is_tex = ext.as_deref() == Some("tex");
        if !is_tex && ext.as_deref() != Some("bib") {
            continue;
        }
        live.insert(e.path.clone());
        if cache.get(&e.path).is_some_and(|c| c.mtime == e.mtime && c.size == e.size) {
            continue;
        }
        let Ok(bytes) = std::fs::read(&e.path) else { continue };
        let text = String::from_utf8_lossy(&bytes);
        let scan = if is_tex { Scan::Tex(Arc::new(scan_tex(&text))) } else { Scan::Bib(Arc::new(scan_bib(&text))) };
        cache.insert(e.path.clone(), Cached { mtime: e.mtime, size: e.size, scan });
    }
    cache.retain(|p, _| live.contains(p));
}

#[tauri::command]
pub async fn index_get(app: AppHandle, pid: String) -> CmdResult<Snapshot> {
    let project = app.state::<Projects>().get(&pid)?;
    tauri::async_runtime::spawn_blocking(move || {
        let indexes = app.state::<Indexes>();
        let mut map = indexes.0.lock().map_err(err)?;
        let cache = map.entry(pid).or_default();
        refresh(&project, cache);
        Ok(snapshot(&project, cache))
    })
    .await
    .map_err(err)?
}

/// A project that is no longer open does not keep its index.
#[tauri::command]
pub fn index_drop(indexes: tauri::State<'_, Indexes>, pid: String) {
    if let Ok(mut m) = indexes.0.lock() {
        m.remove(&pid);
    }
}

// ── References after a move / rename ────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefEdit {
    pub file: PathBuf,
    pub line: u32,
    pub old: String,
    pub new: String,
}

const REF_CMDS: &[&str] = &["input", "include", "subfile", "includegraphics", "addbibresource"];

/// Old absolute path → new one, for every file inside the moved items (a moved folder
/// maps each file under its new location back to where it was).
fn file_moves(moves: &[(PathBuf, PathBuf)]) -> Vec<(PathBuf, PathBuf)> {
    let mut out = Vec::new();
    for (from, to) in moves {
        if to.is_dir() {
            let mut stack = vec![to.clone()];
            while let Some(d) = stack.pop() {
                let Ok(rd) = std::fs::read_dir(&d) else { continue };
                for e in rd.flatten() {
                    let p = e.path();
                    if p.is_dir() {
                        stack.push(p);
                    } else if let Ok(rest) = p.strip_prefix(to) {
                        out.push((from.join(rest), p));
                    }
                }
            }
        } else {
            out.push((from.clone(), to.clone()));
        }
    }
    out
}

fn without_ext(p: &Path) -> PathBuf {
    p.with_extension("")
}

/// If `arg` (as written after `base`) pointed at `old`, the text that points at `new`.
fn rewrite(arg: &str, base: &Path, old: &Path, new: &Path) -> Option<String> {
    let given = base.join(arg);
    let has_ext = Path::new(arg).extension().is_some_and(|e| e.len() <= 4);
    let hit = if has_ext { given == old } else { given == without_ext(old) || given == old };
    if !hit {
        return None;
    }
    let rel = new.strip_prefix(base).ok()?;
    let text = if has_ext { rel.to_path_buf() } else { without_ext(rel) };
    Some(text.to_string_lossy().replace('\\', "/"))
}

fn find_refs(project: &Project, moves: &[(PathBuf, PathBuf)]) -> Vec<RefEdit> {
    let files = file_moves(moves);
    if files.is_empty() {
        return Vec::new();
    }
    let mut edits = Vec::new();
    let entries = tree::search(&project.roots, "", Visibility::default(), 20_000);
    for e in entries.into_iter().filter(|e| !e.dir && e.path.extension().is_some_and(|x| x.eq_ignore_ascii_case("tex"))) {
        let Ok(text) = std::fs::read_to_string(&e.path) else { continue };
        // The file itself may have moved: its folder is the new one now, but the text was
        // written for the old one (relative paths are resolved from the main folder or roots).
        let mut bases: Vec<PathBuf> = Vec::new();
        if let Some(d) = project.main.as_ref().and_then(|m| m.parent()) {
            bases.push(d.to_path_buf());
        }
        if let Some(d) = e.path.parent() {
            bases.push(d.to_path_buf());
        }
        bases.extend(project.roots.iter().cloned());
        for (n, raw) in text.lines().enumerate() {
            for (name, arg) in commands(strip_comment(raw)) {
                if !REF_CMDS.contains(&name) {
                    continue;
                }
                let arg = arg.trim();
                let mut done = false;
                for (old, new) in &files {
                    for base in &bases {
                        if let Some(text) = rewrite(arg, base, old, new) {
                            if text != arg {
                                let edit = RefEdit { file: e.path.clone(), line: n as u32 + 1, old: arg.to_string(), new: text };
                                if !edits.contains(&edit) {
                                    edits.push(edit);
                                }
                            }
                            done = true;
                            break;
                        }
                    }
                    if done {
                        break;
                    }
                }
            }
        }
    }
    edits
}

#[tauri::command]
pub async fn refs_find(app: AppHandle, pid: String, moves: Vec<(PathBuf, PathBuf)>) -> CmdResult<Vec<RefEdit>> {
    let project = app.state::<Projects>().get(&pid)?;
    tauri::async_runtime::spawn_blocking(move || find_refs(&project, &moves)).await.map_err(err)
}

/// Rewrites the `{old}` argument on the edit's line; returns the files changed.
#[tauri::command]
pub async fn refs_apply(app: AppHandle, pid: String, edits: Vec<RefEdit>) -> CmdResult<Vec<PathBuf>> {
    let project = app.state::<Projects>().get(&pid)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut by_file: HashMap<PathBuf, Vec<&RefEdit>> = HashMap::new();
        for e in &edits {
            by_file.entry(crate::fs::guard::inside(&project, &e.file)?).or_default().push(e);
        }
        let mut changed = Vec::new();
        for (file, list) in by_file {
            let raw = std::fs::read_to_string(&file).map_err(err)?;
            let bom = raw.starts_with('\u{feff}');
            let crlf = raw.contains("\r\n");
            let norm = raw.trim_start_matches('\u{feff}').replace("\r\n", "\n");
            let mut lines: Vec<String> = norm.split('\n').map(str::to_string).collect();
            for e in list {
                if let Some(l) = lines.get_mut(e.line as usize - 1) {
                    *l = l.replace(&format!("{{{}}}", e.old), &format!("{{{}}}", e.new));
                }
            }
            crate::fs::text::write(&file, &lines.join("\n"), crlf, bom).map_err(err)?;
            changed.push(file);
        }
        Ok(changed)
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scans_sections_labels_includes_and_skips_comments_and_verbatim() {
        let t = "\\documentclass{article}\n\\begin{document}\n\\section{Wstęp}\\label{sec:wstep}\n% \\section{Ukryta}\n\\input{rozdzialy/a}\n\\begin{verbatim}\n\\section{Kod}\n\\end{verbatim}\n\\subsection*{Cel \\& zakres}\nTo jest zdanie z $x^2$ i \\cite{kowalski}.\n\\end{document}\n";
        let s = scan_tex(t);
        assert_eq!(
            s.items,
            vec![
                (3, Item::Section { level: 2, title: "Wstęp".into() }),
                (5, Item::Include("rozdzialy/a".into())),
                (9, Item::Section { level: 3, title: "Cel & zakres".into() }),
            ]
        );
        assert_eq!(s.labels[0].0, "sec:wstep");
        assert_eq!(s.labels[0].2, "Wstęp");
        assert!(s.words >= 6, "words = {}", s.words);
    }

    #[test]
    fn words_skip_preamble_commands_math_and_refs() {
        let t = "\\usepackage{amsmath}\nPreambuła nie liczy się\n\\begin{document}\nAla ma kota \\textbf{i psa} oraz $a+b$ \\ref{x} \\cite{y}.\n\\end{document}\n";
        assert_eq!(scan_tex(t).words, 6); // Ala ma kota i psa oraz
    }

    #[test]
    fn parses_bib_entries() {
        let b = "@comment{x}\n@article{kow2020,\n  author = {Kowalski, Jan and Nowak, Anna},\n  title = {Metody {LaTeX} w praktyce},\n  year = 2020,\n  journal = \"Nauka\"\n}\n\n@book{lamport,\n  title={LaTeX},\n  author={Lamport, Leslie},\n  date={1994-01-01}\n}\n";
        let s = scan_bib(b);
        assert_eq!(s.entries.len(), 2);
        assert_eq!(s.entries[0].key, "kow2020");
        assert_eq!(s.entries[0].authors, "Kowalski, Jan; Nowak, Anna");
        assert_eq!(s.entries[0].title, "Metody LaTeX w praktyce");
        assert_eq!(s.entries[0].year, "2020");
        assert_eq!(s.entries[0].line, 2);
        assert_eq!(s.entries[1].year, "1994");
    }

    #[test]
    fn outline_follows_includes_in_print_order() {
        let main = PathBuf::from("/p/main.tex");
        let a = PathBuf::from("/p/a.tex");
        let mut cache = HashMap::new();
        let put = |c: &mut HashMap<PathBuf, Cached>, p: &PathBuf, t: &str| {
            c.insert(p.clone(), Cached { mtime: 0, size: 0, scan: Scan::Tex(Arc::new(scan_tex(t))) });
        };
        put(&mut cache, &main, "\\section{Jeden}\n\\input{a}\n\\section{Trzy}\n");
        put(&mut cache, &a, "\\section{Dwa}\n");
        let project = Project { id: "x".into(), name: "x".into(), color: String::new(), roots: vec![PathBuf::from("/p")], main: Some(main), created_at: 0, opened_at: 0 };
        let s = snapshot(&project, &cache);
        let titles: Vec<_> = s.outline.iter().map(|o| o.title.as_str()).collect();
        assert_eq!(titles, ["Jeden", "Dwa", "Trzy"]);
    }

    #[test]
    fn rewrites_input_and_graphics_after_a_move() {
        let base = PathBuf::from("/p");
        let old = PathBuf::from("/p/rozdzialy/a.tex");
        let new = PathBuf::from("/p/czesc/a.tex");
        assert_eq!(rewrite("rozdzialy/a", &base, &old, &new).as_deref(), Some("czesc/a"));
        assert_eq!(rewrite("rozdzialy/a.tex", &base, &old, &new).as_deref(), Some("czesc/a.tex"));
        assert_eq!(rewrite("rozdzialy/b", &base, &old, &new), None);
        let img_old = PathBuf::from("/p/img/x.png");
        let img_new = PathBuf::from("/p/img/y.png");
        assert_eq!(rewrite("img/x", &base, &img_old, &img_new).as_deref(), Some("img/y"));
    }
}
