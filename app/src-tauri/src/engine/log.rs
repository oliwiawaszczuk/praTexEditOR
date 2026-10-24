//! TeX log → diagnostics (docs/02-plan.md §3.2). The frontend never sees the raw log
//! in normal flow, only this short list.
//!
//! TeX wraps log lines at 79 characters, so they are joined first. The current file is
//! tracked by the `(file … )` parentheses TeX prints when it opens and closes inputs;
//! context lines of errors and overfull boxes (which quote the user's text, unbalanced
//! parentheses included) are kept out of that tracking.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
    /// Overfull / underfull boxes: a category of their own, hidden by default.
    Box,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub severity: Severity,
    /// Absolute path of a project file; None = somewhere else (a package, the engine).
    pub file: Option<PathBuf>,
    pub line: Option<u32>,
    pub message: String,
    /// Short Polish explanation for well-known errors.
    pub hint: Option<String>,
}

/// What a `(name` in the log refers to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Frame {
    /// A file of the project (diagnostics point here).
    Project(PathBuf),
    /// A file outside the project (package, class, aux file).
    External,
    /// Not a file: a parenthesis in some message.
    Group,
}

/// Maps file names as TeX prints them (`main.tex`, `./rozdz/a.tex`, `rozdz/a`, absolute
/// paths) to frames. Names are relative to the folder of the main file (the engine's
/// working directory). Results are cached: a log mentions the same packages many times.
pub struct Resolver<'a> {
    base: PathBuf,
    roots: &'a [PathBuf],
    cache: HashMap<String, Frame>,
}

const EXTERNAL_EXT: &[&str] = &[
    ".sty", ".cls", ".clo", ".def", ".cfg", ".fd", ".ldf", ".aux", ".out", ".toc", ".lof", ".lot",
    ".bbl", ".tex", ".dict", ".lbx", ".bbx", ".cbx", ".map", ".enc", ".pfb", ".code", ".nav", ".snm",
];

impl<'a> Resolver<'a> {
    pub fn new(base: &Path, roots: &'a [PathBuf]) -> Self {
        Self {
            base: base.to_path_buf(),
            roots,
            cache: HashMap::new(),
        }
    }

    pub fn frame(&mut self, name: &str) -> Frame {
        if let Some(f) = self.cache.get(name) {
            return f.clone();
        }
        let f = self.lookup(name);
        self.cache.insert(name.to_string(), f.clone());
        f
    }

    fn lookup(&self, name: &str) -> Frame {
        let name = name.trim_matches('"');
        if name.is_empty() || name.starts_with(|c: char| c.is_ascii_digit() || c == '[' || c == '<' || c == '{') {
            return Frame::Group;
        }
        let p = Path::new(name);
        let full = if p.is_absolute() { p.to_path_buf() } else { self.base.join(p) };
        for cand in [full.clone(), PathBuf::from(format!("{}.tex", full.display()))] {
            if cand.is_file() {
                let c = cand.canonicalize().unwrap_or(cand);
                return if self.roots.iter().any(|r| c.starts_with(r)) {
                    Frame::Project(c)
                } else {
                    Frame::External
                };
            }
        }
        let lower = name.to_ascii_lowercase();
        if name.contains('/') || name.contains('\\') || EXTERNAL_EXT.iter().any(|e| lower.ends_with(e)) {
            Frame::External
        } else {
            Frame::Group
        }
    }
}

/// Joins lines TeX broke at its 79-character limit (bytes in pdfTeX, characters in XeTeX).
fn unwrap(log: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    for line in log.lines() {
        cur.push_str(line);
        if line.len() == 79 || line.chars().count() == 79 {
            continue;
        }
        out.push(std::mem::take(&mut cur));
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// The innermost file on the stack: Some(path) for a project file, None otherwise.
fn current(stack: &[Frame]) -> Option<PathBuf> {
    stack.iter().rev().find_map(|f| match f {
        Frame::Project(p) => Some(Some(p.clone())),
        Frame::External => Some(None),
        Frame::Group => None,
    })?
}

/// Push / pop frames for every parenthesis in `line`.
fn track(line: &str, stack: &mut Vec<Frame>, res: &mut Resolver) {
    let b = line.as_bytes();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'(' => {
                let start = i + 1;
                let mut j = start;
                if b.get(j) == Some(&b'"') {
                    j += 1;
                    while j < b.len() && b[j] != b'"' {
                        j += 1;
                    }
                    j = (j + 1).min(b.len());
                } else {
                    while j < b.len() && !matches!(b[j], b' ' | b'(' | b')' | b'\t' | b'[' | b'{' | b'<') {
                        j += 1;
                    }
                }
                stack.push(res.frame(&line[start..j]));
                i = j;
            }
            b')' => {
                stack.pop();
                i += 1;
            }
            _ => i += 1,
        }
    }
}

/// "… on input line 45." → (message without it, Some(45)).
fn input_line(msg: &str) -> (String, Option<u32>) {
    if let Some(at) = msg.rfind(" on input line ") {
        let digits: String = msg[at + 15..].chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(n) = digits.parse::<u32>() {
            let mut m = msg[..at].to_string();
            m.push_str(msg[at + 15 + digits.len()..].trim_end_matches('.'));
            return (m.trim_end().to_string() + ".", Some(n));
        }
    }
    (msg.to_string(), None)
}

/// "./rozdz/a.tex:12: msg" (-file-line-error) → (file, 12, msg).
fn file_line_error(line: &str) -> Option<(&str, u32, &str)> {
    let mut search = 0;
    while let Some(off) = line[search..].find(':') {
        let at = search + off;
        let rest = &line[at + 1..];
        let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if !digits.is_empty() && rest[digits.len()..].starts_with(": ") {
            let file = &line[..at];
            if !file.is_empty() && !file.contains(": ") {
                return Some((file, digits.parse().ok()?, &rest[digits.len() + 2..]));
            }
        }
        search = at + 1;
    }
    None
}

/// Warnings that only say "a rerun would fix this" — the engines rerun on their own.
fn is_rerun_noise(msg: &str) -> bool {
    msg.contains("Rerun to get")
        || msg.contains("may have changed. Rerun")
        || msg.contains("There were undefined references")
        || msg.contains("There were undefined citations")
        || msg.starts_with("File `") && msg.contains("has changed")
        || msg.contains("Rerun LaTeX")
}

fn clean_error(msg: &str) -> String {
    let mut m = msg.trim();
    while let Some(r) = m.strip_prefix("! ") {
        m = r.trim_start();
    }
    let mut s = m.to_string();
    while s.ends_with("..") {
        s.pop();
    }
    s
}

pub fn parse(log: &str, res: &mut Resolver) -> Vec<Diagnostic> {
    let lines = unwrap(log);
    let mut out: Vec<Diagnostic> = Vec::new();
    let mut stack: Vec<Frame> = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i].as_str();

        // Errors: "! msg" or "file:N: msg", then context up to "l.N …" and the help text.
        let fle = file_line_error(line).and_then(|(f, n, m)| match res.frame(f) {
            Frame::Project(p) => Some((Some(p), n, m)),
            Frame::External => Some((None, n, m)),
            Frame::Group => None,
        });
        if line.starts_with("! ") || fle.is_some() {
            let (mut file, mut lnum, msg) = match &fle {
                Some((f, n, m)) => (f.clone(), Some(*n), clean_error(m)),
                None => (current(&stack), None, clean_error(line)),
            };
            let mut context = String::new();
            let mut j = i + 1;
            let mut seen_l = false;
            while j < lines.len() && j < i + 40 {
                let l = lines[j].as_str();
                if seen_l && l.trim().is_empty() {
                    break;
                }
                if l.starts_with("! ") || (!seen_l && file_line_error(l).is_some() && j > i + 1) {
                    j -= 1;
                    break;
                }
                if let Some(rest) = l.strip_prefix("l.") {
                    let n: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                    if let Ok(n) = n.parse::<u32>() {
                        if lnum.is_none() {
                            lnum = Some(n);
                        }
                        context = rest[n.to_string().len()..].trim().to_string();
                        seen_l = true;
                    }
                }
                j += 1;
            }
            if fle.is_none() && file.is_none() {
                file = current(&stack);
            }
            if msg != "Emergency stop." && !msg.starts_with("==> Fatal error") {
                let hint = hint_for(&msg, &context);
                out.push(Diagnostic {
                    severity: Severity::Error,
                    file,
                    line: lnum,
                    message: msg,
                    hint,
                });
            }
            i = j + 1;
            continue;
        }

        // LaTeX / package / class warnings, continued on "(pkg)   …" lines.
        if let Some(at) = line.find(" Warning: ") {
            let who = &line[..at];
            let is_warning = who == "LaTeX" || who == "LaTeX Font" || who.starts_with("Package ") || who.starts_with("Class ");
            if is_warning {
                let pkg = who.rsplit(' ').next().unwrap_or("");
                let mut msg = line[at + 10..].trim().to_string();
                let mut j = i + 1;
                let prefix = format!("({pkg})");
                let cont_line = |l: &str| l.starts_with(&prefix) || who == "LaTeX Font" && l.starts_with("(Font)") || who == "LaTeX" && l.starts_with("  ");
                while j < lines.len() && cont_line(&lines[j]) {
                    let l = lines[j].as_str();
                    let cont = if l.starts_with('(') { l.split_once(')').map(|x| x.1).unwrap_or("") } else { l }.trim();
                    msg.push(' ');
                    msg.push_str(cont);
                    j += 1;
                }
                let (msg, lnum) = input_line(&msg);
                if !is_rerun_noise(&msg) {
                    let msg = if who.starts_with("Package ") || who.starts_with("Class ") { format!("{pkg}: {msg}") } else { msg };
                    out.push(Diagnostic {
                        severity: Severity::Warning,
                        file: current(&stack),
                        line: lnum,
                        hint: hint_for(&msg, ""),
                        message: msg,
                    });
                }
                for l in &lines[i..j] {
                    track(l, &mut stack, res);
                }
                i = j;
                continue;
            }
        }

        // Overfull / underfull boxes; the next lines quote the box content.
        if line.starts_with("Overfull \\") || line.starts_with("Underfull \\") {
            let lnum = line
                .rfind(" at lines ")
                .map(|a| a + 10)
                .or_else(|| line.rfind(" at line ").map(|a| a + 9))
                .and_then(|a| line[a..].chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().ok());
            let msg = match line.find(" in paragraph").or_else(|| line.find(" detected")).or_else(|| line.find(" in alignment")).or_else(|| line.find(" has occurred")) {
                Some(cut) => &line[..cut],
                None => line,
            };
            out.push(Diagnostic {
                severity: Severity::Box,
                file: current(&stack),
                line: lnum,
                message: msg.to_string(),
                hint: None,
            });
            // Box content runs until a blank line (or the "[]" marker line).
            let mut j = i + 1;
            while j < lines.len() && !lines[j].trim().is_empty() && j < i + 12 {
                if lines[j].trim() == "[]" {
                    j += 1;
                    break;
                }
                j += 1;
            }
            i = j;
            continue;
        }

        // pdfLaTeX with a font that lacks the glyph: the letter silently disappears.
        if let Some(rest) = line.strip_prefix("Missing character: There is no ") {
            let ch = rest.split(" in font").next().unwrap_or("").trim();
            out.push(Diagnostic {
                severity: Severity::Warning,
                file: None,
                line: None,
                message: format!("Missing character: {ch}"),
                hint: Some("Znak zniknął z PDF — w pdfLaTeX dodaj \\usepackage[T1]{fontenc} albo użyj Tectonic".into()),
            });
        }

        track(line, &mut stack, res);
        i += 1;
    }

    let mut seen = HashSet::new();
    out.retain(|d| seen.insert((d.severity, d.file.clone(), d.line, d.message.clone())));
    out.truncate(500);
    out
}

/// Tectonic prints `error: file:line: message` itself — the fallback when no log was
/// written (the engine stopped before that).
pub fn parse_engine_errors(lines: &[String], res: &mut Resolver) -> Vec<Diagnostic> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for l in lines {
        let Some(rest) = l.strip_prefix("error: ") else { continue };
        let (file, line, msg) = match file_line_error(rest) {
            Some((f, n, m)) => (
                match res.frame(f) {
                    Frame::Project(p) => Some(p),
                    _ => None,
                },
                Some(n),
                clean_error(m),
            ),
            None => (None, None, rest.trim().to_string()),
        };
        if msg.starts_with("something bad happened") || msg.starts_with("the XeTeX engine had") || !seen.insert((file.clone(), line, msg.clone())) {
            continue;
        }
        out.push(Diagnostic {
            severity: Severity::Error,
            hint: hint_for(&msg, ""),
            file,
            line,
            message: msg,
        });
    }
    out
}

/// Text between the first pair of TeX quotes: "Citation `kowalski' on page" → kowalski.
fn quoted(msg: &str) -> Option<&str> {
    let a = msg.find('`')? + 1;
    let b = a + msg[a..].find('\'')?;
    Some(&msg[a..b])
}

fn hint_for(msg: &str, context: &str) -> Option<String> {
    let m = msg;
    if m.starts_with("Undefined control sequence") {
        let cmd = last_command(context)?;
        return Some(match suggest(&cmd) {
            Some(s) => format!("Nieznana komenda {cmd} — może {s}?"),
            None => format!("Nieznana komenda {cmd} (literówka albo brak pakietu)"),
        });
    }
    if m.contains("Missing $ inserted") {
        return Some("Symbol matematyczny (^, _, \\alpha…) poza $…$ albo niedomknięty $".into());
    }
    if m.contains("LaTeX Error: File `") && m.contains("not found") {
        let f = quoted(m)?;
        return Some(match f.strip_suffix(".sty") {
            Some(pkg) => format!("Nie ma pakietu „{pkg}” — literówka w \\usepackage?"),
            None => format!("Nie ma pliku „{f}” — sprawdź ścieżkę"),
        });
    }
    if m.contains("LaTeX Error: Environment ") && m.contains(" undefined") {
        let env = m.split("Environment ").nth(1)?.split(' ').next()?;
        return Some(format!("Nieznane środowisko „{env}” — literówka albo brak pakietu"));
    }
    if m.contains("LaTeX Error: \\begin{") && m.contains("ended by \\end{") {
        return Some("\\begin i \\end nie pasują do siebie — niedomknięte środowisko?".into());
    }
    if m.starts_with("Citation `") {
        return Some(format!("Brak klucza „{}” w .bib (albo brak \\bibliography)", quoted(m)?));
    }
    if m.starts_with("Reference `") {
        return Some(format!("Brak \\label{{{}}}", quoted(m)?));
    }
    if m.contains("Missing } inserted") || m.contains("Extra }") || m.contains("Too many }'s") || m.contains("Missing { inserted") {
        return Some("Nawiasy { } się nie bilansują".into());
    }
    if m.contains("File ended while scanning") || m.contains("Runaway argument") {
        return Some("Niedomknięty nawias { w argumencie komendy".into());
    }
    if m.contains("Paragraph ended before") {
        return Some("Pusty wiersz w argumencie komendy (niedomknięty nawias?)".into());
    }
    if m.contains("unavailable in encoding OT1") || m.contains("Unicode character") && m.contains("not set up for use with LaTeX") {
        return Some("Polskie znaki w pdfLaTeX: \\usepackage[T1]{fontenc} (albo Tectonic)".into());
    }
    if m.contains("Misplaced alignment tab character &") {
        return Some("& poza tabelą lub align — w tekście pisz \\&".into());
    }
    if m.contains("Double superscript") || m.contains("Double subscript") {
        return Some("Dwa ^ lub _ z rzędu — zgrupuj w { }".into());
    }
    if m.contains("There's no line here to end") {
        return Some("\\\\ tam, gdzie nie ma wiersza do zakończenia".into());
    }
    if m.contains("Missing \\begin{document}") {
        return Some("Tekst przed \\begin{document} albo zły plik główny".into());
    }
    if m.contains("Can be used only in preamble") {
        return Some("Ta komenda musi być przed \\begin{document}".into());
    }
    None
}

/// TeX breaks the `l.N` context right after the offending token.
fn last_command(context: &str) -> Option<String> {
    let at = context.rfind('\\')?;
    let name: String = context[at + 1..].chars().take_while(|c| c.is_ascii_alphabetic() || *c == '@').collect();
    (!name.is_empty()).then(|| format!("\\{name}"))
}

const COMMON: &[&str] = &[
    "includegraphics", "textbf", "textit", "underline", "emph", "section", "subsection", "subsubsection",
    "chapter", "paragraph", "caption", "label", "ref", "eqref", "pageref", "cite", "citep", "citet",
    "footnote", "item", "begin", "end", "frac", "dfrac", "tfrac", "sqrt", "sum", "int", "prod", "lim",
    "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "lambda", "sigma", "omega", "theta",
    "infty", "partial", "nabla", "cdot", "times", "leq", "geq", "neq", "approx", "mathbf", "mathrm",
    "mathcal", "mathbb", "left", "right", "hline", "toprule", "midrule", "bottomrule", "multicolumn",
    "centering", "maketitle", "tableofcontents", "usepackage", "documentclass", "newcommand",
    "renewcommand", "input", "include", "bibliography", "bibliographystyle", "printbibliography",
    "addbibresource", "textwidth", "linewidth", "hspace", "vspace", "newline", "newpage", "clearpage",
    "noindent", "url", "href", "texttt", "textsc", "small", "large", "Large", "footnotesize", "today",
    "author", "title", "date", "frametitle", "includepdf", "textcolor", "color", "quad", "qquad",
    "ldots", "dots", "cdots", "overline", "hat", "vec", "bar", "tilde", "text", "operatorname",
];

fn distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut cur = vec![i; b.len() + 1];
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            cur[j] = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + cost);
        }
        prev = cur;
    }
    prev[b.len()]
}

fn suggest(cmd: &str) -> Option<String> {
    let name = cmd.trim_start_matches('\\');
    let limit = if name.len() <= 4 { 1 } else { 2 };
    COMMON
        .iter()
        .map(|c| (distance(name, c), *c))
        .filter(|(d, c)| *d > 0 && *d <= limit && *c != name)
        .min_by_key(|(d, _)| *d)
        .map(|(_, c)| format!("\\{c}"))
}

pub fn counts(diags: &[Diagnostic]) -> (usize, usize, usize) {
    diags.iter().fold((0, 0, 0), |(e, w, b), d| match d.severity {
        Severity::Error => (e + 1, w, b),
        Severity::Warning => (e, w + 1, b),
        Severity::Box => (e, w, b + 1),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> String {
        let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/logs").join(name);
        String::from_utf8_lossy(&std::fs::read(p).unwrap()).into_owned()
    }

    /// The project from which the fixtures were made: main.tex + rozdzialy/01-metody.tex.
    fn project() -> (tempfile::TempDir, PathBuf) {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().canonicalize().unwrap();
        std::fs::create_dir_all(root.join("rozdzialy")).unwrap();
        std::fs::write(root.join("main.tex"), "x").unwrap();
        std::fs::write(root.join("rozdzialy/01-metody.tex"), "x").unwrap();
        (d, root)
    }

    fn run(log: &str) -> (Vec<Diagnostic>, PathBuf, tempfile::TempDir) {
        let (d, root) = project();
        let roots = vec![root.clone()];
        let mut r = Resolver::new(&root, &roots);
        (parse(log, &mut r), root, d)
    }

    #[test]
    fn tectonic_errors_point_into_the_input_file() {
        let (ds, root, _d) = run(&fixture("tectonic-errors.log"));
        let errs: Vec<_> = ds.iter().filter(|d| d.severity == Severity::Error).collect();
        assert_eq!(errs.len(), 2, "{errs:#?}");
        let metody = root.join("rozdzialy/01-metody.tex");
        assert_eq!(errs[0].file.as_ref(), Some(&metody));
        assert_eq!(errs[0].line, Some(3));
        assert_eq!(errs[0].message, "Undefined control sequence.");
        assert_eq!(errs[0].hint.as_deref(), Some("Nieznana komenda \\inclugraphics — może \\includegraphics?"));
        assert_eq!(errs[1].line, Some(5));
        assert!(errs[1].hint.as_ref().unwrap().contains("$"));

        let warns: Vec<_> = ds.iter().filter(|d| d.severity == Severity::Warning).collect();
        assert!(warns.iter().any(|w| w.message.starts_with("Reference `sec:brak'") && w.line == Some(6) && w.file.as_ref() == Some(&root.join("main.tex"))), "{warns:#?}");
        assert!(warns.iter().any(|w| w.hint.as_deref() == Some("Brak klucza „nieznany2020” w .bib (albo brak \\bibliography)")));
        assert!(!warns.iter().any(|w| w.message.contains("Rerun") || w.message.contains("There were")), "{warns:#?}");

        // The overfull box after the \input closed is back in main.tex.
        let b = ds.iter().find(|d| d.severity == Severity::Box).unwrap();
        assert_eq!(b.file.as_ref(), Some(&root.join("main.tex")));
        assert_eq!(b.line, Some(8));
        assert_eq!(b.message, "Overfull \\hbox (202.6165pt too wide)");
    }

    #[test]
    fn warnings_only() {
        let (ds, _, _d) = run(&fixture("tectonic-warnings.log"));
        assert_eq!(counts(&ds).0, 0, "{ds:#?}");
        assert_eq!(counts(&ds).1, 2, "{ds:#?}");
        assert_eq!(counts(&ds).2, 1);
    }

    #[test]
    fn pdflatex_file_line_errors() {
        let (ds, root, _d) = run(&fixture("pdflatex-errors.log"));
        let errs: Vec<_> = ds.iter().filter(|d| d.severity == Severity::Error).collect();
        let metody = root.join("rozdzialy/01-metody.tex");
        assert!(errs.iter().any(|e| e.file.as_ref() == Some(&metody) && e.line == Some(2) && e.message.starts_with("Undefined control sequence")), "{errs:#?}");
        assert!(errs.iter().any(|e| e.file.as_ref() == Some(&metody) && e.line == Some(4) && e.message.starts_with("Missing $")), "{errs:#?}");
        let enc = errs.iter().find(|e| e.message.contains("unavailable in encoding OT1")).unwrap();
        assert_eq!(enc.file.as_ref(), Some(&root.join("main.tex")));
        assert_eq!(enc.line, Some(5));
        assert!(enc.hint.as_ref().unwrap().contains("fontenc"));
        // Same error from the second latexmk pass is not repeated.
        assert_eq!(errs.iter().filter(|e| e.line == Some(2) && e.file.as_ref() == Some(&metody)).count(), 1);
    }

    #[test]
    fn missing_package() {
        let (ds, root, _d) = run(&fixture("tectonic-missing-package.log"));
        let first = &ds[0];
        assert_eq!(first.message, "LaTeX Error: File `pakietktoregoniema.sty' not found.");
        assert_eq!(first.file.as_ref(), Some(&root.join("main.tex")));
        assert_eq!(first.line, Some(3));
        assert_eq!(first.hint.as_deref(), Some("Nie ma pakietu „pakietktoregoniema” — literówka w \\usepackage?"));
    }

    #[test]
    fn engine_error_lines() {
        let (_d, root) = project();
        let roots = vec![root.clone()];
        let mut r = Resolver::new(&root, &roots);
        let lines: Vec<String> = fixture("tectonic-errors.stdout").lines().map(str::to_string).collect();
        let ds = parse_engine_errors(&lines, &mut r);
        assert_eq!(ds.len(), 2, "{ds:#?}");
        assert_eq!(ds[0].file.as_ref(), Some(&root.join("rozdzialy/01-metody.tex")));
        assert_eq!(ds[0].line, Some(3));
    }

    #[test]
    fn unbalanced_parens_in_quoted_source_do_not_break_tracking() {
        let log = "(main.tex\n(rozdzialy/01-metody\n! Undefined control sequence.\nl.2 Tekst (bez zamkniecia \\foo\n                         x\n\n)\nLaTeX Warning: Reference `a' on page 1 undefined on input line 9.\n\n)\n";
        let (ds, root, _d) = run(log);
        assert_eq!(ds[0].file.as_ref(), Some(&root.join("rozdzialy/01-metody.tex")));
        assert_eq!(ds[1].file.as_ref(), Some(&root.join("main.tex")), "{ds:#?}");
        assert_eq!(ds[1].line, Some(9));
    }

    #[test]
    fn suggestions() {
        assert_eq!(suggest("\\textbff").as_deref(), Some("\\textbf"));
        assert_eq!(suggest("\\sectoin").as_deref(), Some("\\section"));
        assert_eq!(suggest("\\zzzzzz"), None);
        assert_eq!(last_command("Tekst \\inclugraphics"), Some("\\inclugraphics".into()));
    }

    #[test]
    fn wrapped_lines_are_joined() {
        let a = "x".repeat(79);
        assert_eq!(unwrap(&format!("{a}\nyz\nnext")), vec![format!("{a}yz"), "next".into()]);
        assert_eq!(input_line("Citation `k' on page 1 undefined on input line 17."), ("Citation `k' on page 1 undefined.".into(), Some(17)));
    }
}
