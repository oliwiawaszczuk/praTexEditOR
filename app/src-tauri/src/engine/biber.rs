//! biblatex under Tectonic (docs/02-plan.md §14). Tectonic runs the *system* biber, but its
//! bundle carries its own biblatex (3.17 → biber 2.17 only); any other biber rejects the
//! `.bcf` and no PDF comes out. The engine output only says "external tool exited with
//! error code 2", so the biber step is watched here and turned into one clear diagnostic.

use std::path::{Path, PathBuf};

use super::log::{Diagnostic, Severity};

#[derive(Debug, Default)]
pub struct Watch {
    ran: bool,
    failed: bool,
    missing: bool,
    /// `ERROR - …` lines biber printed (Tectonic echoes its stdout on failure).
    errors: Vec<String>,
    /// (biber, biblatex) from biber's incompatibility note.
    versions: Option<(String, String)>,
}

impl Watch {
    pub fn line(&mut self, line: &str) {
        if line.starts_with("note: Running external tool biber") {
            self.ran = true;
            return;
        }
        if !self.ran {
            return;
        }
        if self.versions.is_none() {
            self.versions = versions(line);
        }
        if let Some(e) = line.strip_prefix("ERROR - ") {
            self.errors.push(e.trim().to_string());
        } else if line.starts_with("error: ") {
            self.failed = true;
            // Spawn failure: "No such file or directory (os error 2)" / Windows "(os error 2)".
            if line.contains("(os error 2)") {
                self.missing = true;
            }
        }
    }

    /// The diagnostic for a failed biber step; `main` = the user's main file (None for a
    /// generated wrapper), `latexmk` = a system TeX is there to switch to.
    pub fn diagnostic(&self, main: Option<&Path>, latexmk: bool) -> Option<Diagnostic> {
        if !self.failed {
            return None;
        }
        let fix = "dopisz backend=bibtex: \\usepackage[backend=bibtex]{biblatex} (BibTeX jest w Tectonic)";
        let switch = if latexmk { " albo przełącz silnik na latexmk" } else { "" };
        let (message, hint) = if self.missing {
            ("biblatex potrzebuje programu biber, a nie ma go w systemie".to_string(), format!("Najprościej: {fix}{switch}"))
        } else if let Some((biber, biblatex)) = &self.versions {
            (
                format!("Biber {biber} nie pasuje do biblatex {biblatex} z Tectonic"),
                format!("Tectonic ma starszy biblatex — {fix}{switch}"),
            )
        } else {
            let first = self.errors.first().cloned().unwrap_or_else(|| "Biber zakończył się błędem".into());
            (first, "Błąd bibera — zwykle składnia pliku .bib (pełny opis w logu)".to_string())
        };
        let (file, line) = match main.and_then(|m| Some((m.to_path_buf(), locate(&std::fs::read_to_string(m).ok()?)?))) {
            Some((f, l)) => (Some(f), Some(l)),
            None => (None::<PathBuf>, None),
        };
        Some(Diagnostic {
            severity: Severity::Error,
            file,
            line,
            message,
            hint: Some(hint),
        })
    }
}

/// "This means that your biber (2.22) and biblatex (3.17) versions are incompatible."
fn versions(e: &str) -> Option<(String, String)> {
    let between = |s: &str, from: &str| -> Option<String> {
        let a = s.find(from)? + from.len();
        let b = a + s[a..].find(')')?;
        Some(s[a..b].to_string())
    };
    Some((between(e, "biber (")?, between(e, "biblatex (")?))
}

/// 1-based line of the `\usepackage{biblatex}` (with options or not), comments skipped.
fn locate(src: &str) -> Option<u32> {
    src.lines().position(|l| {
        let code = l.split('%').next().unwrap_or_default();
        code.contains("{biblatex}") && (code.contains("\\usepackage") || code.contains("\\RequirePackage"))
    })
    .map(|i| i as u32 + 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MISMATCH: &[&str] = &[
        "note: Running TeX ...",
        "note: Running external tool biber ...",
        "error: the external tool exited with an error code; its stdout was:",
        "INFO - This is Biber 2.22",
        "ERROR - Error: Found biblatex control file version 3.8, expected version 3.11.",
        "This means that your biber (2.22) and biblatex (3.17) versions are incompatible.",
        "error: the external tool exited with error code 2",
    ];

    fn watch(lines: &[&str]) -> Watch {
        let mut w = Watch::default();
        for l in lines {
            w.line(l);
        }
        w
    }

    #[test]
    fn version_mismatch_names_both_versions() {
        let d = watch(MISMATCH).diagnostic(None, true).unwrap();
        assert_eq!(d.message, "Biber 2.22 nie pasuje do biblatex 3.17 z Tectonic");
        let h = d.hint.unwrap();
        assert!(h.contains("backend=bibtex") && h.contains("latexmk"));
    }

    #[test]
    fn missing_biber() {
        let d = watch(&["note: Running external tool biber ...", "error: No such file or directory (os error 2)"])
            .diagnostic(None, false)
            .unwrap();
        assert!(d.message.contains("nie ma go w systemie"));
        assert!(!d.hint.unwrap().contains("latexmk"));
    }

    #[test]
    fn other_errors_and_success() {
        let d = watch(&["note: Running external tool biber ...", "ERROR - BibTeX subsystem: ref.bib, line 3, syntax error", "error: the external tool exited with error code 2"])
            .diagnostic(None, false)
            .unwrap();
        assert!(d.message.starts_with("BibTeX subsystem"));
        assert!(watch(&["note: Running external tool biber ...", "note: Rerunning TeX"]).diagnostic(None, true).is_none());
        // TeX errors before biber are not biber's.
        assert!(watch(&["error: main.tex:3: Undefined control sequence"]).diagnostic(None, true).is_none());
    }

    #[test]
    fn points_at_the_usepackage_line() {
        let dir = tempfile::tempdir().unwrap();
        let main = dir.path().join("main.tex");
        std::fs::write(&main, "\\documentclass{article}\n% \\usepackage{biblatex}\n\\usepackage[style=apa]{biblatex}\n").unwrap();
        let d = watch(MISMATCH).diagnostic(Some(&main), false).unwrap();
        assert_eq!((d.file.as_deref(), d.line), (Some(main.as_path()), Some(3)));
    }
}
