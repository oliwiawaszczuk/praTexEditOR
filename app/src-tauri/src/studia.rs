//! Template "Studia": a project root holds `notatki.sty` and subject folders
//! (`<subject>/main.tex` + `<subject>/content/01_x.tex, 02_y.tex …`). A build never
//! compiles `main.tex` as it lies: the app writes a wrapper into `<cache>/build/<pid>/studia/`
//! (main.tex with its `%% NOTATKI` line replaced by `\input`s of the notes) and runs the
//! engine there, with the subject folder as working directory and the root on the TeX search
//! path. The user's folders get nothing but the exported PDFs.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::core::jsonio::write_atomic;
use crate::core::{err, CmdResult};
use crate::fs::guard;
use crate::fs::tree::natural_cmp;
use crate::projects::registry::{Project, Projects};

pub const STYLE_FILE: &str = "notatki.sty";
const MARKER: &str = "%% NOTATKI";
/// Dropped from the wrapper of a single note (cover page + table of contents).
const COVER: &str = "\\okladka";

pub const BLANK_MAIN: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../templates/studia/blank-przedmiot/main.tex"));

/// What to compile: a whole subject, or one note of it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub subject: PathBuf,
    #[serde(default)]
    pub note: Option<PathBuf>,
}

#[derive(Debug)]
pub struct Plan {
    /// The generated `.tex` in the cache; its stem names the engine outputs.
    pub wrapper: PathBuf,
    /// Working directory of the engine (relative `\input`, images).
    pub subject: PathBuf,
    /// Folder with `notatki.sty`, added to the TeX search path.
    pub root: PathBuf,
    /// Where an export goes: next to `main.tex` of the subject.
    pub export: PathBuf,
}

fn subject_name(subject: &Path) -> String {
    subject.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "przedmiot".into())
}

/// Name of the engine outputs: unique per target, plain ASCII.
fn stem_of(subject: &Path, note: Option<&Path>) -> String {
    use std::hash::{DefaultHasher, Hash, Hasher};
    let mut h = DefaultHasher::new();
    (subject, note).hash(&mut h);
    format!("studia-{:08x}", h.finish() & 0xffff_ffff)
}

/// Notes of a subject in the order of their names (`01_`, `02_`, … ; `10` after `9`).
pub fn content_files(subject: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(subject.join("content"))
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
    v.sort_by(|a, b| natural_cmp(&a.to_string_lossy().to_lowercase(), &b.to_string_lossy().to_lowercase()));
    v
}

/// `\input` argument for a file relative to the subject; a name TeX cannot read is an error.
fn input_cmd(rel: &str) -> Result<String, String> {
    if rel.chars().any(|c| matches!(c, '%' | '#' | '\\' | '{' | '}' | '~' | '$' | '^' | '&')) {
        return Err(format!("Nazwa pliku „{rel}” ma znak, którego TeX nie przyjmie w \\input — zmień nazwę"));
    }
    Ok(if rel.contains(' ') { format!("\\input{{\"{rel}\"}}") } else { format!("\\input{{{rel}}}") })
}

fn words(folder: &str) -> Vec<&str> {
    folder.split(|c: char| c == '-' || c == '_' || c.is_whitespace()).filter(|w| !w.is_empty()).collect()
}

/// "inzynieria-wiedzy" → ("INZYNIERIA WIEDZY", "Inzynieria Wiedzy").
pub fn display_names(folder: &str) -> (String, String) {
    let ws = words(folder);
    let upper = ws.join(" ").to_uppercase();
    let title = ws
        .iter()
        .map(|w| {
            let mut cs = w.chars();
            cs.next().map(|f| f.to_uppercase().chain(cs).collect::<String>()).unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ");
    (upper, title)
}

fn names_def(folder: &str) -> String {
    let (upper, title) = display_names(folder);
    format!("\\gdef\\przedmiotduze{{{}}}\\gdef\\przedmiotmale{{{}}}", tex_escape(&upper), tex_escape(&title))
}

/// `main.tex` with the `%% NOTATKI` line replaced by one line of `\input`s. Line numbers stay
/// the same, so an error in `main.tex` points at the right line. `single`: no cover page.
///
/// The subject name comes from the folder (`inzynieria-wiedzy` → "INZYNIERIA WIEDZY" on the
/// cover, "Inzynieria Wiedzy" in the page header): it is defined on the `\usepackage{notatki}`
/// line, before the package is read.
pub fn compose(main: &str, name: &str, inputs: &[String], single: bool) -> Result<String, String> {
    let mut out = Vec::new();
    let mut found = false;
    for line in main.lines() {
        let t = line.trim_start();
        if t.starts_with(MARKER) {
            found = true;
            out.push(inputs.iter().map(|i| input_cmd(i)).collect::<Result<Vec<_>, _>>()?.join(""));
        } else if t.starts_with("\\usepackage{notatki}") {
            out.push(format!("{}{line}", names_def(name)));
        } else if single && t.starts_with(COVER) {
            out.push("%".to_string());
        } else {
            out.push(line.to_string());
        }
    }
    if !found {
        return Err(format!("main.tex przedmiotu nie ma linii „{MARKER}” — tam appka wstawia notatki"));
    }
    Ok(out.join("\n") + "\n")
}

pub fn plan(project: &Project, t: &Target, work: &Path) -> Result<Plan, String> {
    let subject = guard::inside(project, &t.subject)?;
    let root = subject.parent().map(Path::to_path_buf).ok_or("Niepoprawny folder przedmiotu")?;
    if !project.roots.contains(&root) || !root.join(STYLE_FILE).is_file() {
        return Err("To nie jest folder przedmiotu w projekcie Studia".into());
    }
    let main_file = subject.join("main.tex");
    let main = std::fs::read(&main_file).map_err(|_| format!("Przedmiot „{}” nie ma main.tex", subject_name(&subject)))?;
    let rel = |p: &Path| p.strip_prefix(&subject).map(|r| r.to_string_lossy().replace('\\', "/")).map_err(|_| "Notatka jest poza przedmiotem".to_string());
    let (inputs, note_stem) = match &t.note {
        Some(n) => {
            let n = guard::inside(project, n)?;
            if n.parent() != Some(subject.join("content").as_path()) || n.extension().is_none_or(|e| e != "tex") {
                return Err("Notatka musi leżeć w content/ tego przedmiotu".into());
            }
            let stem = n.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            (vec![rel(&n)?], Some((n, stem)))
        }
        None => {
            let files = content_files(&subject);
            if files.is_empty() {
                return Err(format!("Przedmiot „{}” nie ma jeszcze notatek w content/ — dodaj pierwszą (Nowa notatka)", subject_name(&subject)));
            }
            (files.iter().map(|f| rel(f)).collect::<Result<Vec<_>, _>>()?, None)
        }
    };
    let text = compose(&String::from_utf8_lossy(&main), &subject_name(&subject), &inputs, note_stem.is_some())?;
    let stem = stem_of(&subject, note_stem.as_ref().map(|(p, _)| p.as_path()));
    let dir = work.join("studia");
    let wrapper = dir.join(format!("{stem}.tex"));
    write_atomic(&wrapper, text.as_bytes()).map_err(err)?;
    let name = subject_name(&subject);
    let export = subject.join(match &note_stem {
        Some((_, s)) => format!("{name}_{s}.pdf"),
        None => format!("{name}.pdf"),
    });
    Ok(Plan { wrapper, subject, root, export })
}

// ── Commands ─────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudiaInfo {
    pub root: PathBuf,
}

/// Is this a "Studia" project (a root with `notatki.sty`)?
#[tauri::command]
pub fn studia_info(reg: State<'_, Projects>, pid: String) -> CmdResult<Option<StudiaInfo>> {
    let project = reg.get(&pid)?;
    Ok(project.roots.iter().find(|r| r.join(STYLE_FILE).is_file()).map(|r| StudiaInfo { root: r.clone() }))
}

fn studia_root(project: &Project) -> CmdResult<PathBuf> {
    project.roots.iter().find(|r| r.join(STYLE_FILE).is_file()).cloned().ok_or_else(|| "To nie jest projekt Studia (brak notatki.sty w katalogu głównym)".to_string())
}

/// Characters that cannot stay in a file name or that TeX would choke on in `\input`.
fn slug(title: &str) -> String {
    let s: String = title
        .trim()
        .chars()
        .map(|c| if c.is_whitespace() { '_' } else { c })
        .filter(|c| !c.is_control() && !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '%' | '#' | '{' | '}' | '~' | '$' | '^' | '&'))
        .collect();
    let s = s.trim_matches(|c| c == '_' || c == '.').to_string();
    s.chars().take(60).collect()
}

fn tex_escape(s: &str) -> String {
    let mut o = String::new();
    for c in s.chars() {
        match c {
            '\\' => o.push_str("\\textbackslash{}"),
            '&' | '%' | '$' | '#' | '_' | '{' | '}' => {
                o.push('\\');
                o.push(c);
            }
            '~' => o.push_str("\\textasciitilde{}"),
            '^' => o.push_str("\\textasciicircum{}"),
            c => o.push(c),
        }
    }
    o
}

/// Next free number: one above the highest leading number in `content/` (at least 2 digits).
fn next_number(names: &[String]) -> (u32, usize) {
    let mut max = 0;
    let mut width = 2;
    for n in names {
        let digits: String = n.chars().take_while(char::is_ascii_digit).collect();
        if let Ok(v) = digits.parse::<u32>() {
            max = max.max(v);
            width = width.max(digits.len());
        }
    }
    (max + 1, width)
}

/// "Nowa notatka": `content/NN_<title>.tex` with the `\notatka` header. Never overwrites.
#[tauri::command]
pub fn studia_new_note(reg: State<'_, Projects>, pid: String, subject: PathBuf, title: String, date: String) -> CmdResult<PathBuf> {
    let project = reg.get(&pid)?;
    let root = studia_root(&project)?;
    let subject = guard::inside(&project, &subject)?;
    if subject.parent() != Some(root.as_path()) {
        return Err("Wybierz folder przedmiotu".into());
    }
    let title = guard::valid_name(&title)?.to_string();
    let name = slug(&title);
    if name.is_empty() {
        return Err("Niedozwolona nazwa".into());
    }
    let content = subject.join("content");
    std::fs::create_dir_all(&content).map_err(err)?;
    let names: Vec<String> = std::fs::read_dir(&content).map_err(err)?.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    let (n, width) = next_number(&names);
    let file = content.join(format!("{n:0width$}_{name}.tex"));
    if file.exists() {
        return Err("Taka notatka już istnieje".into());
    }
    let date = date.trim();
    let head = if date.is_empty() { format!("\\notatka{{{}}}", tex_escape(&title)) } else { format!("\\notatka[{}]{{{}}}", tex_escape(date), tex_escape(&title)) };
    write_atomic(&file, format!("{head}\n\n").as_bytes()).map_err(err)?;
    Ok(file)
}

/// "Nowy przedmiot": `<root>/<name>/` with `main.tex` and an empty `content/`.
#[tauri::command]
pub fn studia_new_subject(reg: State<'_, Projects>, pid: String, name: String) -> CmdResult<PathBuf> {
    let project = reg.get(&pid)?;
    let root = studia_root(&project)?;
    let name = guard::valid_name(&name)?.to_string();
    let dir = root.join(&name);
    if dir.exists() {
        return Err("Przedmiot o tej nazwie już istnieje".into());
    }
    std::fs::create_dir_all(dir.join("content")).map_err(err)?;
    write_atomic(&dir.join("main.tex"), BLANK_MAIN.as_bytes()).map_err(err)?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAIN: &str = "\\documentclass{article}\n\\usepackage{notatki}\n\\autor{}\n\\begin{document}\n\\okladka\n%% NOTATKI (x)\n\\end{document}\n";

    #[test]
    fn compose_replaces_marker_and_keeps_line_numbers() {
        let all = compose(MAIN, "inzynieria-wiedzy", &["content/01_a.tex".into(), "content/02_b c.tex".into()], false).unwrap();
        assert_eq!(all.lines().count(), MAIN.lines().count());
        assert!(all.contains("\\okladka"));
        assert!(all.contains("\\gdef\\przedmiotduze{INZYNIERIA WIEDZY}\\gdef\\przedmiotmale{Inzynieria Wiedzy}\\usepackage{notatki}"), "{all}");
        assert!(all.contains("\\input{content/01_a.tex}\\input{\"content/02_b c.tex\"}"));
        let one = compose(MAIN, "x", &["content/01_a.tex".into()], true).unwrap();
        assert!(!one.contains("\\okladka"));
        assert_eq!(one.lines().count(), MAIN.lines().count());
    }

    #[test]
    fn folder_names_become_titles() {
        assert_eq!(display_names("inzynieria-wiedzy"), ("INZYNIERIA WIEDZY".into(), "Inzynieria Wiedzy".into()));
        assert_eq!(display_names("bio_informatyka 2"), ("BIO INFORMATYKA 2".into(), "Bio Informatyka 2".into()));
        assert_eq!(display_names("łacina"), ("ŁACINA".into(), "Łacina".into()));
    }

    #[test]
    fn compose_needs_the_marker_and_clean_names() {
        assert!(compose("\\begin{document}\\end{document}", "x", &[], false).is_err());
        assert!(compose(MAIN, "x", &["content/a%b.tex".into()], false).is_err());
    }

    #[test]
    fn notes_come_in_natural_order() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("content")).unwrap();
        for n in ["10_x.tex", "02_b.tex", "01_a.tex", "9_n.tex", "notes.txt", ".hidden.tex"] {
            std::fs::write(d.path().join("content").join(n), "").unwrap();
        }
        let names: Vec<String> = content_files(d.path()).iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect();
        assert_eq!(names, ["01_a.tex", "02_b.tex", "9_n.tex", "10_x.tex"]);
    }

    fn project_in(root: &Path) -> Project {
        Project { id: "p".into(), name: "studia".into(), color: String::new(), roots: vec![root.to_path_buf()], main: None, created_at: 0, opened_at: 0 }
    }

    /// The template written to disk, wrapped for a whole subject and for one note.
    #[test]
    fn plans_a_subject_and_a_note() {
        let d = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(d.path()).unwrap();
        crate::projects::templates::write(crate::projects::templates::find("studia").unwrap(), &root).unwrap();
        let project = project_in(&root);
        let work = root.join("cache");
        let subject = root.join("Przyklad");

        let all = plan(&project, &Target { subject: subject.clone(), note: None }, &work).unwrap();
        let text = std::fs::read_to_string(&all.wrapper).unwrap();
        assert!(text.contains("\\input{content/01_boksy.tex}\\input{content/02_druga.tex}"), "{text}");
        assert!(text.contains("\\okladka"));
        assert_eq!(all.export, subject.join("Przyklad.pdf"));
        assert!(all.wrapper.starts_with(&work));

        let note = subject.join("content/02_druga.tex");
        let one = plan(&project, &Target { subject: subject.clone(), note: Some(note.clone()) }, &work).unwrap();
        let text = std::fs::read_to_string(&one.wrapper).unwrap();
        assert!(text.contains("\\input{content/02_druga.tex}") && !text.contains("01_boksy") && !text.contains("\\okladka"));
        assert_eq!(one.export, subject.join("Przyklad_02_druga.pdf"));
        assert_ne!(one.wrapper, all.wrapper);

        // Not a note of this subject, not a subject at all, empty subject.
        assert!(plan(&project, &Target { subject: subject.clone(), note: Some(subject.join("main.tex")) }, &work).is_err());
        assert!(plan(&project, &Target { subject: root.clone(), note: None }, &work).is_err());
        assert!(plan(&project, &Target { subject: root.join("blank-przedmiot"), note: None }, &work).unwrap_err().contains("nie ma jeszcze notatek"));
    }

    /// Real LuaLaTeX run of the wrapper the way the build starts it. Needs TeX Live.
    #[test]
    #[ignore]
    fn compiles_a_subject_with_lualatex() {
        let d = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(d.path()).unwrap();
        crate::projects::templates::write(crate::projects::templates::find("studia").unwrap(), &root).unwrap();
        let project = project_in(&root);
        let bin = crate::engine::latexmk::detect(false).latexmk.expect("latexmk");
        let out = root.join("cache/out");
        std::fs::create_dir_all(&out).unwrap();
        let note = root.join("Przyklad/content/01_boksy.tex");
        for t in [Target { subject: root.join("Przyklad"), note: None }, Target { subject: root.join("Przyklad"), note: Some(note) }] {
            let p = plan(&project, &t, &root.join("cache")).unwrap();
            let st = crate::engine::latexmk::command(&bin, "-lualatex", &p.wrapper, &out, Some(&p)).status().unwrap();
            assert!(st.success(), "{t:?}");
            assert!(out.join(p.wrapper.file_stem().unwrap()).with_extension("pdf").is_file());
        }
        // The subject folder stays clean.
        assert_eq!(std::fs::read_dir(root.join("Przyklad")).unwrap().count(), 2);
    }

    #[test]
    fn numbering_and_names() {
        assert_eq!(next_number(&[]), (1, 2));
        assert_eq!(next_number(&["01_a.tex".into(), "07_b.tex".into(), "x.tex".into()]), (8, 2));
        assert_eq!(next_number(&["099_a.tex".into()]), (100, 3));
        assert_eq!(slug("  Sekwencjonowanie: Sanger / NGS  "), "Sekwencjonowanie_Sanger__NGS");
        assert_eq!(tex_escape("PCR & 50%"), "PCR \\& 50\\%");
    }
}
