//! Child processes that belong to the user's system (file manager, `xdg-open`, TeX Live)
//! must not inherit what an AppImage injects for *our* bundled GTK/WebKit — a leaked
//! `LD_LIBRARY_PATH` makes Dolphin, `xdg-open` or `pdflatex` load the wrong libraries and
//! silently fail. Outside an AppImage (and on macOS / Windows) this does nothing.

use std::process::Command;

/// A command for a program of the host system.
#[cfg(unix)]
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut c = Command::new(program);
    clean(&mut c);
    c
}

#[cfg(unix)]
pub fn clean(cmd: &mut Command) -> &mut Command {
    let Some(appdir) = std::env::var_os("APPDIR").map(|a| a.to_string_lossy().into_owned()) else {
        return cmd;
    };
    // Colon lists: keep the user's own entries, drop the ones inside the AppDir.
    for key in ["LD_LIBRARY_PATH", "XDG_DATA_DIRS", "XDG_CONFIG_DIRS", "PATH", "GST_PLUGIN_PATH", "QT_PLUGIN_PATH", "PERLLIB", "PYTHONPATH"] {
        if let Some(v) = std::env::var_os(key) {
            let kept: Vec<String> = v.to_string_lossy().split(':').filter(|p| !p.is_empty() && !p.starts_with(&appdir)).map(str::to_string).collect();
            if kept.is_empty() {
                cmd.env_remove(key);
            } else {
                cmd.env(key, kept.join(":"));
            }
        }
    }
    // Single values pointing into the AppDir.
    for key in [
        "LD_PRELOAD",
        "GDK_PIXBUF_MODULE_FILE",
        "GDK_PIXBUF_MODULEDIR",
        "GSETTINGS_SCHEMA_DIR",
        "GIO_EXTRA_MODULES",
        "GTK_PATH",
        "GTK_EXE_PREFIX",
        "GTK_DATA_PREFIX",
        "GTK_IM_MODULE_FILE",
        "PYTHONHOME",
    ] {
        if std::env::var_os(key).is_some_and(|v| v.to_string_lossy().starts_with(&appdir)) {
            cmd.env_remove(key);
        }
    }
    cmd
}

#[cfg(not(unix))]
pub fn clean(cmd: &mut Command) -> &mut Command {
    cmd
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn appimage_entries_are_dropped_and_user_entries_kept() {
        // Only this test touches these variables.
        unsafe {
            std::env::set_var("APPDIR", "/tmp/.mount_abc");
            std::env::set_var("LD_LIBRARY_PATH", "/tmp/.mount_abc/usr/lib:/opt/mine/lib");
            std::env::set_var("GSETTINGS_SCHEMA_DIR", "/tmp/.mount_abc/usr/share/glib-2.0/schemas");
            std::env::set_var("GTK_PATH", "/usr/lib/gtk-3.0");
        }
        let mut c = Command::new("true");
        clean(&mut c);
        let env: std::collections::HashMap<_, _> = c.get_envs().map(|(k, v)| (k.to_string_lossy().into_owned(), v.map(|v| v.to_string_lossy().into_owned()))).collect();
        assert_eq!(env["LD_LIBRARY_PATH"].as_deref(), Some("/opt/mine/lib"));
        assert_eq!(env["GSETTINGS_SCHEMA_DIR"], None, "removed");
        assert!(!env.contains_key("GTK_PATH"), "not inside the AppDir: untouched");
        unsafe {
            std::env::remove_var("APPDIR");
        }
    }
}
