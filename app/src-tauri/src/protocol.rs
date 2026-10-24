//! `pratex://` — PDFs and images straight from disk to the webview (docs/02-plan.md §5.1):
//! no base64, no JSON over IPC. Byte ranges are honoured.
//!
//!   pratex://localhost/pdf/<pid>?v=<rev>      the project's current PDF (build cache)
//!   pratex://localhost/file/<pid>?p=<path>    a file of the project (guarded), for previews
//!   pratex://localhost/board/<bid>?f=<file>   an image asset of a whiteboard
//!
//! (Windows: http://pratex.localhost/…)

use std::path::{Path, PathBuf};

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, UriSchemeContext};

use crate::core::paths::Paths;
use crate::engine::build::published_pdf;
use crate::fs::guard;
use crate::projects::registry::Projects;

pub const SCHEME: &str = "pratex";

pub fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                match u8::from_str_radix(std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or("zz"), 16) {
                    Ok(v) => {
                        out.push(v);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(b'%');
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn query_param(query: &str, key: &str) -> Option<String> {
    query
        .split('&')
        .filter_map(|kv| kv.split_once('='))
        .find(|(k, _)| *k == key)
        .map(|(_, v)| decode(v))
}

fn content_type(p: &Path) -> &'static str {
    match p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("pdf") => "application/pdf",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("bmp") => "image/bmp",
        Some("tif" | "tiff") => "image/tiff",
        _ => "application/octet-stream",
    }
}

fn status(code: StatusCode, msg: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(code)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(msg.as_bytes().to_vec())
        .unwrap()
}

/// "bytes=a-b" / "bytes=a-" / "bytes=-n" → [start, end) within `len`.
fn range(h: &str, len: u64) -> Option<(u64, u64)> {
    let spec = h.trim().strip_prefix("bytes=")?.split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;
    let (start, end) = match (a.trim(), b.trim()) {
        ("", n) => {
            let n: u64 = n.parse().ok()?;
            (len.saturating_sub(n), len)
        }
        (s, "") => (s.parse().ok()?, len),
        (s, e) => (s.parse().ok()?, e.parse::<u64>().ok()?.saturating_add(1).min(len)),
    };
    (start < end && start < len).then_some((start, end))
}

fn serve(path: &Path, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(path) else {
        return status(StatusCode::NOT_FOUND, "brak pliku");
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let base = Response::builder()
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Content-Length, Content-Range, Accept-Ranges")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_TYPE, content_type(path));
    let wanted = req.headers().get(header::RANGE).and_then(|v| v.to_str().ok());
    if let Some((start, end)) = wanted.and_then(|h| range(h, len)) {
        let mut buf = vec![0u8; (end - start) as usize];
        if f.seek(SeekFrom::Start(start)).is_err() || f.read_exact(&mut buf).is_err() {
            return status(StatusCode::INTERNAL_SERVER_ERROR, "błąd odczytu");
        }
        return base
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_RANGE, format!("bytes {start}-{}/{len}", end - 1))
            .body(buf)
            .unwrap();
    }
    let mut buf = Vec::with_capacity(len as usize);
    if f.read_to_end(&mut buf).is_err() {
        return status(StatusCode::INTERNAL_SERVER_ERROR, "błąd odczytu");
    }
    base.status(StatusCode::OK).body(buf).unwrap()
}

fn resolve(app: &AppHandle, route: &str, pid: &str, query: &str) -> Result<PathBuf, (StatusCode, &'static str)> {
    match route {
        "pdf" => Ok(published_pdf(&app.state::<Paths>(), pid)),
        "file" => {
            let project = app.state::<Projects>().get(pid).map_err(|_| (StatusCode::NOT_FOUND, "brak projektu"))?;
            let p = query_param(query, "p").ok_or((StatusCode::BAD_REQUEST, "brak ścieżki"))?;
            guard::inside(&project, Path::new(&p)).map_err(|_| (StatusCode::FORBIDDEN, "poza projektem"))
        }
        "board" => {
            let f = query_param(query, "f").ok_or((StatusCode::BAD_REQUEST, "brak pliku"))?;
            crate::boards::asset_path(&app.state::<Paths>(), pid, &f).ok_or((StatusCode::BAD_REQUEST, "zła nazwa"))
        }
        _ => Err((StatusCode::NOT_FOUND, "nieznany adres")),
    }
}

pub fn handle(app: &AppHandle, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    if req.method() == tauri::http::Method::OPTIONS {
        return Response::builder()
            .status(StatusCode::NO_CONTENT)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Range")
            .body(Vec::new())
            .unwrap();
    }
    let uri = req.uri();
    let path = decode(uri.path());
    let mut parts = path.trim_start_matches('/').splitn(2, '/');
    let (Some(route), Some(pid)) = (parts.next(), parts.next()) else {
        return status(StatusCode::NOT_FOUND, "nieznany adres");
    };
    match resolve(app, route, pid, uri.query().unwrap_or("")) {
        Ok(p) => serve(&p, req),
        Err((code, msg)) => status(code, msg),
    }
}

/// Register on the builder: each request is served on its own thread (file reads never
/// block the webview's main loop).
pub fn register(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.register_asynchronous_uri_scheme_protocol(SCHEME, |ctx: UriSchemeContext<'_, tauri::Wry>, req, responder| {
        let app = ctx.app_handle().clone();
        std::thread::spawn(move || responder.respond(handle(&app, &req)));
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges() {
        assert_eq!(range("bytes=0-99", 1000), Some((0, 100)));
        assert_eq!(range("bytes=900-", 1000), Some((900, 1000)));
        assert_eq!(range("bytes=-100", 1000), Some((900, 1000)));
        assert_eq!(range("bytes=990-2000", 1000), Some((990, 1000)));
        assert_eq!(range("bytes=1000-", 1000), None);
        assert_eq!(range("items=0-1", 1000), None);
    }

    #[test]
    fn serves_whole_files_and_ranges() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("doc.pdf");
        std::fs::write(&f, b"%PDF-1.7 0123456789").unwrap();
        let req = Request::builder().uri("pratex://localhost/pdf%2Fp1?v=1").body(Vec::new()).unwrap();
        let r = serve(&f, &req);
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(r.headers()[header::CONTENT_TYPE], "application/pdf");
        assert_eq!(r.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");
        assert_eq!(r.body().len(), 19);
        let req = Request::builder().uri("pratex://localhost/x").header(header::RANGE, "bytes=0-7").body(Vec::new()).unwrap();
        let r = serve(&f, &req);
        assert_eq!(r.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(r.body(), b"%PDF-1.7");
        assert_eq!(r.headers()[header::CONTENT_RANGE], "bytes 0-7/19");
        assert_eq!(serve(&d.path().join("nope.pdf"), &req).status(), StatusCode::NOT_FOUND);
        assert_eq!(decode(Request::builder().uri("pratex://localhost/pdf%2Fp1").body(()).unwrap().uri().path()), "/pdf/p1");
    }

    #[test]
    fn decoding() {
        assert_eq!(decode("%2FUsers%2Fola%2Fwykres%20%C5%BC.png"), "/Users/ola/wykres ż.png");
        assert_eq!(query_param("v=3&p=%2Fa%2Fb.png", "p").as_deref(), Some("/a/b.png"));
        assert_eq!(decode("100%"), "100%");
    }
}
