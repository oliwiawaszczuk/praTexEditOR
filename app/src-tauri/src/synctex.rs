//! SyncTeX (docs/02-plan.md §6): `doc.synctex.gz` → an index, queried both ways.
//! The frontend never touches the file; it asks `synctex_forward` (code → PDF) and
//! `synctex_inverse` (PDF → code) and gets rectangles / a file + line.
//!
//! The file is a stream of records per page: `(` / `)` open/close an hbox (one output
//! line, tagged with the line where its paragraph ended), `[` / `]` a vbox, and point
//! records (`x` `g` `k` `$` `h`) tagged with the exact input line of each word. So a
//! point gives the precise line, and its enclosing hbox gives the rectangle on the page.
//! Coordinates are scaled points from the top-left corner of the page (1 in margin
//! included); we store PDF points (bp), top-left origin, like the viewer uses.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::core::paths::Paths;
use crate::core::{err, CmdResult};
use crate::fs::guard;
use crate::projects::registry::Projects;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Rect {
    /// 0-based page index.
    pub page: usize,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Place {
    pub file: PathBuf,
    pub line: u32,
}

struct HBox {
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    tag: u32,
    line: u32,
    /// (x, tag, line) of every point record inside, in output order.
    points: Vec<(f32, u32, u32)>,
}

#[derive(Default)]
pub struct Index {
    /// Input tag → canonical path (only inputs that exist on disk).
    files: HashMap<u32, PathBuf>,
    pages: Vec<Vec<HBox>>,
    /// (tag, line) → hboxes holding a point of that line.
    by_point: HashMap<(u32, u32), Vec<(usize, usize)>>,
    /// (tag, line) → hboxes tagged with that line (paragraph ends).
    by_box: HashMap<(u32, u32), Vec<(usize, usize)>>,
}

/// "tag,line[,col]:h,v[:W,H,D]" → numbers.
/// tag, line, h, v, optional (W, H, D).
type Fields = (u32, u32, i64, i64, Option<(i64, i64, i64)>);

fn fields(s: &str) -> Option<Fields> {
    let mut parts = s.split(':');
    let mut tl = parts.next()?.split(',');
    let tag = tl.next()?.parse().ok()?;
    let line = tl.next()?.parse().ok()?;
    let mut hv = parts.next()?.split(',');
    let h = hv.next()?.parse().ok()?;
    let v = hv.next()?.parse().ok()?;
    let size = parts.next().and_then(|p| {
        let mut n = p.split(',').map(|x| x.parse::<i64>().ok());
        let w = n.next()??;
        Some((w, n.next().flatten().unwrap_or(0), n.next().flatten().unwrap_or(0)))
    });
    Some((tag, line, h, v, size))
}

fn push_unique(v: &mut Vec<(usize, usize)>, item: (usize, usize)) {
    if v.last() != Some(&item) {
        v.push(item);
    }
}

impl Index {
    /// `base`: the engine's working directory (relative inputs); `keep`: canonical path
    /// filter (project files only).
    pub fn parse(reader: impl BufRead, base: &Path, keep: &dyn Fn(&Path) -> bool) -> Self {
        let mut ix = Index::default();
        let mut scale = 1.0f64 / 65536.0 * 72.0 / 72.27;
        let (mut unit, mut mag) = (1.0f64, 1000.0f64);
        let (mut xoff, mut yoff) = (0.0f64, 0.0f64);
        let mut page: Option<usize> = None;
        // Open boxes: Some(index into the page) for hboxes, None for vboxes.
        let mut stack: Vec<Option<usize>> = Vec::new();
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let Some(first) = line.chars().next() else { continue };
            let rest = &line[first.len_utf8()..];
            match first {
                'I' if line.starts_with("Input:") => {
                    let Some((tag, path)) = line[6..].split_once(':') else { continue };
                    let (Ok(tag), false) = (tag.parse::<u32>(), path.is_empty()) else { continue };
                    let p = Path::new(path);
                    let full = if p.is_absolute() { p.to_path_buf() } else { base.join(p) };
                    if let Ok(c) = full.canonicalize() {
                        if keep(&c) {
                            ix.files.insert(tag, c);
                        }
                    }
                }
                'U' if line.starts_with("Unit:") => unit = line[5..].trim().parse().unwrap_or(1.0),
                'M' if line.starts_with("Magnification:") => mag = line[14..].trim().parse().unwrap_or(1000.0),
                'X' if line.starts_with("X Offset:") => xoff = line[9..].trim().parse().unwrap_or(0.0),
                'Y' if line.starts_with("Y Offset:") => yoff = line[9..].trim().parse().unwrap_or(0.0),
                'C' if line.starts_with("Content:") => scale = unit * mag / 1000.0 / 65536.0 * 72.0 / 72.27,
                'P' if line.starts_with("Postamble:") => break,
                '{' => {
                    let n: usize = rest.trim().parse().unwrap_or(ix.pages.len() + 1);
                    let i = n.saturating_sub(1);
                    while ix.pages.len() <= i {
                        ix.pages.push(Vec::new());
                    }
                    page = Some(i);
                    stack.clear();
                }
                '}' => {
                    page = None;
                    stack.clear();
                }
                '[' => stack.push(None),
                ']' | ')' => {
                    stack.pop();
                }
                '(' | 'x' | 'g' | 'k' | '$' | 'h' | 'v' => {
                    let (Some(p), Some((tag, ln, h, v, size))) = (page, fields(rest)) else {
                        if first == '(' {
                            stack.push(None);
                        }
                        continue;
                    };
                    let x = ((h as f64 + xoff) * scale) as f32;
                    let y = ((v as f64 + yoff) * scale) as f32;
                    if first == '(' {
                        let (w, ht, d) = size.unwrap_or((0, 0, 0));
                        let b = HBox {
                            x,
                            y: y - (ht as f64 * scale) as f32,
                            w: (w as f64 * scale) as f32,
                            h: ((ht + d) as f64 * scale) as f32,
                            tag,
                            line: ln,
                            points: Vec::new(),
                        };
                        let i = ix.pages[p].len();
                        ix.pages[p].push(b);
                        push_unique(ix.by_box.entry((tag, ln)).or_default(), (p, i));
                        stack.push(Some(i));
                    } else if let Some(Some(i)) = stack.iter().rev().find(|s| s.is_some()) {
                        ix.pages[p][*i].points.push((x, tag, ln));
                        push_unique(ix.by_point.entry((tag, ln)).or_default(), (p, *i));
                    }
                }
                _ => {}
            }
        }
        ix
    }

    fn rect(&self, (p, i): (usize, usize)) -> Rect {
        let b = &self.pages[p][i];
        Rect { page: p, x: b.x, y: b.y, w: b.w, h: b.h }
    }

    /// Code → PDF: rectangles of the output lines that come from `file:line` (the
    /// nearest line with output if that one has none, e.g. a blank line or `\input`).
    pub fn forward(&self, file: &Path, line: u32) -> Vec<Rect> {
        let tags: Vec<u32> = self.files.iter().filter(|(_, p)| p.as_path() == file).map(|(t, _)| *t).collect();
        if tags.is_empty() {
            return Vec::new();
        }
        let hits = |l: u32| -> Vec<(usize, usize)> {
            let mut v: Vec<(usize, usize)> = Vec::new();
            for t in &tags {
                if let Some(h) = self.by_point.get(&(*t, l)) {
                    v.extend(h);
                }
            }
            if v.is_empty() {
                for t in &tags {
                    if let Some(h) = self.by_box.get(&(*t, l)) {
                        v.extend(h);
                    }
                }
            }
            v
        };
        // Prefer the line itself, then lines above (the text the cursor follows), then below.
        let mut found = hits(line);
        let mut d = 1;
        while found.is_empty() && d <= 200 {
            if line > d {
                found = hits(line - d);
            }
            if found.is_empty() {
                found = hits(line + d);
            }
            d += 1;
        }
        found.sort_unstable();
        found.dedup();
        let mut rects: Vec<Rect> = found.into_iter().map(|h| self.rect(h)).filter(|r| r.w > 0.0).collect();
        // A line in a nested box shows up in its parent too: keep the outermost (whole
        // output line) and drop rectangles inside another one.
        let all = rects.clone();
        rects.retain(|r| !all.iter().any(|o| o != r && o.page == r.page && o.x <= r.x && o.y <= r.y && o.x + o.w >= r.x + r.w && o.y + o.h >= r.y + r.h));
        rects.truncate(40);
        rects
    }

    /// PDF → code: the source line of the word at (x, y) on `page` (PDF points,
    /// top-left origin).
    pub fn inverse(&self, page: usize, x: f32, y: f32) -> Option<Place> {
        let boxes = self.pages.get(page)?;
        let dist = |b: &HBox| -> f32 {
            let dx = if x < b.x { b.x - x } else if x > b.x + b.w { x - b.x - b.w } else { 0.0 };
            let dy = if y < b.y { b.y - y } else if y > b.y + b.h { y - b.y - b.h } else { 0.0 };
            dx + dy * 4.0 // vertical misses matter more: the line above/below is another line
        };
        // Inside a box: the smallest one; otherwise the nearest.
        let best = boxes
            .iter()
            .filter(|b| b.w > 0.0 && (b.points.iter().any(|p| self.files.contains_key(&p.1)) || self.files.contains_key(&b.tag)))
            .min_by(|a, b| {
                let (da, db) = (dist(a), dist(b));
                da.partial_cmp(&db).unwrap().then((a.w * a.h).partial_cmp(&(b.w * b.h)).unwrap())
            })?;
        let known: Vec<&(f32, u32, u32)> = best.points.iter().filter(|p| self.files.contains_key(&p.1)).collect();
        // Point records mark word *ends* (and pdfLaTeX tags the paragraph's first one,
        // the indent, with the line where the paragraph ends): the word under the click
        // is the first point to its right.
        let nearest = known.iter().find(|p| p.0 >= x - 0.5).or(known.last());
        let (tag, line) = match nearest {
            Some(p) => (p.1, p.2),
            None => (best.tag, best.line),
        };
        Some(Place {
            file: self.files.get(&tag)?.clone(),
            line,
        })
    }
}

/// Parsed indexes of the projects' current PDFs, rebuilt when the file changes.
#[derive(Default)]
pub struct Syncs(Mutex<HashMap<String, (u64, Arc<Index>)>>);

fn index_for(app: &AppHandle, pid: &str) -> CmdResult<Arc<Index>> {
    let project = app.state::<Projects>().get(pid)?;
    let file = app.state::<Paths>().build_dir(pid).join("doc.synctex.gz");
    let stamp = std::fs::metadata(&file)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos() as u64)
        .ok_or("Brak danych SyncTeX — skompiluj dokument")?;
    let syncs = app.state::<Syncs>();
    if let Some((s, ix)) = syncs.0.lock().map_err(err)?.get(pid) {
        if *s == stamp {
            return Ok(ix.clone());
        }
    }
    let f = std::fs::File::open(&file).map_err(err)?;
    let base = project.main.as_deref().and_then(Path::parent).map(Path::to_path_buf).unwrap_or_default();
    let roots = project.roots.clone();
    let keep = move |p: &Path| roots.iter().any(|r| p.starts_with(r));
    let ix = Arc::new(Index::parse(BufReader::new(flate2::read::GzDecoder::new(f)), &base, &keep));
    syncs.0.lock().map_err(err)?.insert(pid.to_string(), (stamp, ix.clone()));
    Ok(ix)
}

/// After a build: parse in the background, so the first click is instant.
pub fn warm(app: &AppHandle, pid: &str) {
    let (app, pid) = (app.clone(), pid.to_string());
    std::thread::spawn(move || {
        let _ = index_for(&app, &pid);
    });
}

#[tauri::command]
pub async fn synctex_forward(app: AppHandle, pid: String, file: PathBuf, line: u32) -> CmdResult<Vec<Rect>> {
    let project = app.state::<Projects>().get(&pid)?;
    let file = guard::inside(&project, &file)?;
    tauri::async_runtime::spawn_blocking(move || Ok(index_for(&app, &pid)?.forward(&file, line)))
        .await
        .map_err(err)?
}

#[tauri::command]
pub async fn synctex_inverse(app: AppHandle, pid: String, page: usize, x: f32, y: f32) -> CmdResult<Option<Place>> {
    tauri::async_runtime::spawn_blocking(move || Ok(index_for(&app, &pid)?.inverse(page, x, y)))
        .await
        .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The fixture project (tests/fixtures/synctex/projekt): main.tex with
    /// \input{rozdzialy/01-metody} on page 1 and \input{rozdzialy/dodatki/a} on page 2.
    fn load(name: &str) -> (Index, PathBuf) {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/synctex");
        let project = root.join("projekt").canonicalize().unwrap();
        let text = std::fs::read_to_string(root.join(name)).unwrap().replace("$PROJECT", project.to_str().unwrap());
        let keep = |p: &Path| p.starts_with(&project);
        (Index::parse(text.as_bytes(), &project, &keep), project)
    }

    fn check(name: &str) {
        let (ix, project) = load(name);
        let main = project.join("main.tex");
        let metody = project.join("rozdzialy/01-metody.tex");
        let dodatek = project.join("rozdzialy/dodatki/a.tex");
        assert_eq!(ix.files.len(), 3, "{name}: only project files are kept");

        // Forward: the \input file's line 4 is on page 1, below its line 2.
        let a = ix.forward(&metody, 2);
        let b = ix.forward(&metody, 4);
        assert!(!a.is_empty() && !b.is_empty(), "{name}");
        assert_eq!(a[0].page, 0);
        assert!(b[0].y > a[0].y, "{name}: {a:?} {b:?}");
        // Text from the nested folder is on page 2.
        let c = ix.forward(&dodatek, 1);
        assert_eq!(c[0].page, 1, "{name}");
        // A paragraph spanning two output lines → two rectangles; the first line of the
        // page sits below the 1 in top margin (72 bp).
        let p = ix.forward(&main, 5);
        assert!(p[0].y > 72.0 && p[0].y < 200.0, "{name}: {p:?}");
        // Blank line 7 (between \input and the paragraph) → nearest line with output.
        assert!(!ix.forward(&main, 7).is_empty());

        // Inverse: the middle of each forward rectangle maps back to the same place.
        for (file, line, r) in [(&metody, 2, a[0]), (&metody, 4, b[0]), (&dodatek, 1, c[0])] {
            let hit = ix.inverse(r.page, r.x + 20.0, r.y + r.h / 2.0).unwrap();
            assert_eq!((&hit.file, hit.line), (file, line), "{name}");
        }
        // A click in the margin next to a line still finds that line.
        let hit = ix.inverse(b[0].page, 10.0, b[0].y + b[0].h / 2.0).unwrap();
        assert_eq!(hit.file, metody);
        // Display math on page 2 comes from main.tex.
        assert!(ix.forward(&main, 14).iter().all(|r| r.page == 1));
    }

    #[test]
    fn tectonic_both_ways() {
        check("tectonic.synctex");
    }

    #[test]
    fn pdflatex_both_ways() {
        check("pdflatex.synctex");
    }

    /// Click just left of every word end in both fixtures: the line must come back.
    #[test]
    fn every_word_maps_to_its_line() {
        for name in ["tectonic.synctex", "pdflatex.synctex"] {
            let (ix, _) = load(name);
            let (mut ok, mut all) = (0, 0);
            for (p, boxes) in ix.pages.iter().enumerate() {
                for b in boxes {
                    // Skip the paragraph-start point (indent) and boxes inside other boxes.
                    for (k, &(x, tag, line)) in b.points.iter().enumerate().skip(1) {
                        if !ix.files.contains_key(&tag) || b.points[k - 1].0 >= x - 1.0 {
                            continue;
                        }
                        all += 1;
                        let hit = ix.inverse(p, x - 1.0, b.y + b.h / 2.0).unwrap();
                        if hit.file == ix.files[&tag] && hit.line == line {
                            ok += 1;
                        }
                    }
                }
            }
            assert!(all > 20, "{name}: {all}");
            assert!(ok * 100 >= all * 95, "{name}: {ok}/{all}");
        }
    }

    #[test]
    fn record_fields() {
        assert_eq!(fields("1,4:8209694,8930590"), Some((1, 4, 8209694, 8930590, None)));
        assert_eq!(fields("7,3:1,-2:30,4,5"), Some((7, 3, 1, -2, Some((30, 4, 5)))));
        assert_eq!(fields("1,4:10,20:18014866"), Some((1, 4, 10, 20, Some((18014866, 0, 0)))));
    }
}

#[cfg(test)]
mod bench {
    /// PRATEX_SYNCTEX=<file.synctex.gz> cargo test --release synctex_parse_time -- --ignored --nocapture
    #[test]
    #[ignore]
    fn synctex_parse_time() {
        let Some(p) = std::env::var_os("PRATEX_SYNCTEX") else { return };
        let t = std::time::Instant::now();
        let f = std::fs::File::open(&p).unwrap();
        let ix = super::Index::parse(std::io::BufReader::new(flate2::read::GzDecoder::new(f)), std::path::Path::new("/"), &|_| true);
        let parsed = t.elapsed();
        let t = std::time::Instant::now();
        for page in 0..ix.pages.len() {
            let _ = ix.inverse(page, 200.0, 400.0);
        }
        println!("pages {} parse {parsed:?}, inverse per page {:?}", ix.pages.len(), t.elapsed() / ix.pages.len().max(1) as u32);
    }
}
