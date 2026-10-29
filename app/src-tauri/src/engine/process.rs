//! Child processes we may need to kill (app exit, cancelled or timed-out builds), with
//! stdout/stderr streamed line by line — no polling, one reader thread per pipe.
//! Each child leads its own process group, so a kill also stops what it spawned
//! (latexmk → pdflatex → bibtex).

use std::io::{self, BufRead, BufReader, Read};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;

use shared_child::SharedChild;

/// Every running child, so `RunEvent::Exit` can stop them all.
#[derive(Default)]
pub struct Procs(Mutex<Vec<Arc<SharedChild>>>);

impl Procs {
    pub fn kill_all(&self) {
        if let Ok(list) = self.0.lock() {
            for c in list.iter() {
                kill_tree(c);
            }
        }
    }

    fn add(&self, c: &Arc<SharedChild>) {
        if let Ok(mut l) = self.0.lock() {
            l.push(c.clone());
        }
    }

    fn remove(&self, c: &Arc<SharedChild>) {
        if let Ok(mut l) = self.0.lock() {
            l.retain(|x| !Arc::ptr_eq(x, c));
        }
    }
}

/// Kill a child together with its process group (unix) / process tree (Windows).
fn kill_tree(c: &SharedChild) {
    #[cfg(unix)]
    {
        // The child is its group's leader (process_group(0) at spawn).
        let pgid = c.id() as i32;
        if pgid > 0 {
            unsafe {
                libc::kill(-pgid, libc::SIGKILL);
            }
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/PID", &c.id().to_string(), "/T", "/F"])
            .creation_flags(0x0800_0000)
            .status();
    }
    let _ = c.kill();
}

/// Lets another thread stop one particular run (cancel button, timeout).
#[derive(Default)]
pub struct Killer {
    child: Mutex<Option<Arc<SharedChild>>>,
    killed: std::sync::atomic::AtomicBool,
}

impl Killer {
    pub fn kill(&self) {
        self.killed.store(true, std::sync::atomic::Ordering::SeqCst);
        if let Some(c) = self.child.lock().unwrap().as_ref() {
            kill_tree(c);
        }
    }

    pub fn was_killed(&self) -> bool {
        self.killed.load(std::sync::atomic::Ordering::SeqCst)
    }
}

/// Run to completion, calling `on_line` for every output line (stdout and stderr
/// interleaved in arrival order) on the calling thread.
pub fn run_streaming(procs: &Procs, cmd: Command, on_line: impl FnMut(&str)) -> io::Result<ExitStatus> {
    run_killable(procs, None, cmd, on_line)
}

/// `run_streaming` that `killer` can stop from another thread.
pub fn run_killable(
    procs: &Procs,
    killer: Option<&Killer>,
    mut cmd: Command,
    mut on_line: impl FnMut(&str),
) -> io::Result<ExitStatus> {
    crate::core::hostenv::clean(&mut cmd);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    if killer.is_some_and(|k| k.was_killed()) {
        return Err(io::Error::new(io::ErrorKind::Interrupted, "anulowano"));
    }
    let child = Arc::new(SharedChild::spawn(&mut cmd)?);
    procs.add(&child);
    if let Some(k) = killer {
        *k.child.lock().unwrap() = Some(child.clone());
        // A cancel that raced the spawn.
        if k.was_killed() {
            kill_tree(&child);
        }
    }

    let (tx, rx) = mpsc::channel::<String>();
    let readers: Vec<_> = [
        child.take_stdout().map(|p| Box::new(p) as Box<dyn Read + Send>),
        child.take_stderr().map(|p| Box::new(p) as Box<dyn Read + Send>),
    ]
    .into_iter()
    .flatten()
    .map(|pipe| {
        let tx = tx.clone();
        thread::spawn(move || {
            // Lossy: TeX logs are not guaranteed UTF-8 (8-bit fonts, broken input).
            let mut r = BufReader::new(pipe);
            let mut buf = Vec::new();
            while r.read_until(b'\n', &mut buf).unwrap_or(0) > 0 {
                let line = String::from_utf8_lossy(&buf).trim_end().to_string();
                if tx.send(line).is_err() {
                    break;
                }
                buf.clear();
            }
        })
    })
    .collect();
    drop(tx);

    for line in rx {
        on_line(&line);
    }
    for r in readers {
        let _ = r.join();
    }
    let status = child.wait();
    procs.remove(&child);
    if let Some(k) = killer {
        k.child.lock().unwrap().take();
    }
    status
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn streams_both_pipes() {
        let procs = Procs::default();
        let mut cmd = Command::new("sh");
        cmd.args(["-c", "echo out; echo err >&2; exit 3"]);
        let mut lines = Vec::new();
        let st = run_streaming(&procs, cmd, |l| lines.push(l.to_string())).unwrap();
        lines.sort();
        assert_eq!(lines, ["err", "out"]);
        assert_eq!(st.code(), Some(3));
        assert!(procs.0.lock().unwrap().is_empty());
    }

    #[test]
    fn killer_stops_the_whole_group() {
        let procs = Procs::default();
        let killer = Arc::new(Killer::default());
        let k2 = killer.clone();
        let t = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(200));
            k2.kill();
        });
        let mut cmd = Command::new("sh");
        // The grandchild keeps the pipe open: only a group kill ends the run.
        cmd.args(["-c", "sleep 30 & sleep 30; echo never"]);
        let started = std::time::Instant::now();
        let mut lines = Vec::new();
        let st = run_killable(&procs, Some(&killer), cmd, |l| lines.push(l.to_string())).unwrap();
        t.join().unwrap();
        assert!(!st.success());
        assert!(lines.is_empty());
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
        assert!(killer.was_killed());
    }
}
