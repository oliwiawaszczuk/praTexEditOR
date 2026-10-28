mod boards;
mod core;
mod engine;
mod fs;
mod git;
mod index;
mod notes;
mod projects;
mod protocol;
mod synctex;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, RunEvent, Runtime, WindowEvent};

use crate::core::paths::Paths;
use crate::core::settings::SettingsLock;
use crate::engine::build::Builds;
use crate::engine::process::Procs;
use crate::engine::status::EngineState;
use crate::fs::watcher::Watch;
use crate::projects::registry::Projects;
use crate::projects::OpenProject;

/// Set after the first close request, so a hung frontend can never trap the window:
/// the second click on the close button always closes.
struct CloseRequested(AtomicBool);

/// The default menu minus "Close Window": ⌘W closes the editor tab (handled in the
/// webview), it must never close the whole window. The Edit items stay — WKWebView
/// implements Cmd+C/V/X/Z/A in text fields through them.
fn app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;
    #[cfg(target_os = "macos")]
    menu.append(
        &SubmenuBuilder::new(app, app.package_info().name.clone())
            .item(&tauri::menu::PredefinedMenuItem::about(app, None, None)?)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?,
    )?;
    #[cfg(not(target_os = "macos"))]
    menu.append(&SubmenuBuilder::new(app, "Plik").quit().build()?)?;
    menu.append(
        &SubmenuBuilder::new(app, "Edycja")
            .undo()
            .redo()
            .separator()
            .cut()
            .copy()
            .paste()
            .select_all()
            .build()?,
    )?;
    menu.append(
        &SubmenuBuilder::new(app, "Projekt")
            .text("project_new", "Nowy projekt…")
            .text("project_folder", "Otwórz folder…")
            .separator()
            .text("project_all", "Wszystkie projekty")
            .build()?,
    )?;
    let mut window = SubmenuBuilder::new(app, "Okno").minimize().maximize();
    if cfg!(target_os = "macos") {
        window = window.separator().fullscreen();
    }
    menu.append(&window.build()?)?;
    Ok(menu)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = protocol::register(tauri::Builder::default())
        .plugin(tauri_plugin_dialog::init())
        .manage(SettingsLock::default())
        .manage(core::userdata::UserDataLock::default())
        .manage(Procs::default())
        .manage(Builds::default())
        .manage(synctex::Syncs::default())
        .manage(index::Indexes::default())
        .manage(boards::BoardsLock::default())
        .manage(EngineState::default())
        .manage(Watch::default())
        .manage(OpenProject::default())
        .manage(CloseRequested(AtomicBool::new(false)))
        .invoke_handler(tauri::generate_handler![
            core::settings::settings_get,
            core::settings::settings_set,
            core::userdata::userdata_get,
            core::userdata::userdata_set,
            core::userdata::import_json_file,
            engine::status::engine_status,
            engine::status::engine_selftest,
            engine::status::diagnostics,
            engine::status::tectonic_cache,
            engine::status::tectonic_cache_clear,
            engine::build::build_request,
            engine::build::build_cancel,
            engine::build::build_state,
            engine::build::build_log,
            engine::build::build_clean,
            engine::build::pdf_export,
            engine::build::pdf_open_external,
            engine::build::open_url,
            engine::build::engines_detect,
            boards::boards_list,
            boards::boards_create,
            boards::boards_rename,
            boards::boards_delete,
            boards::board_get,
            boards::board_set,
            boards::board_asset_add,
            boards::board_asset_from_path,
            boards::board_export_png,
            notes::notes_list,
            notes::notes_create,
            notes::notes_get,
            notes::notes_set,
            notes::notes_append,
            notes::notes_delete,
            git::git_repos,
            git::git_log,
            git::diff::git_changes,
            git::diff::git_file_diff,
            git::ops::git_init,
            git::ops::git_discard_hunk,
            git::ops::git_discard,
            git::ops::git_restore_from,
            index::index_get,
            index::index_drop,
            index::refs_find,
            index::refs_apply,
            index::packages_missing,
            index::preamble_add,
            synctex::synctex_forward,
            synctex::synctex_inverse,
            projects::projects_list,
            projects::project_create,
            projects::project_from_template,
            projects::project_unzip,
            projects::detect_main,
            projects::project_update,
            projects::project_set_root,
            projects::project_remove_root,
            projects::project_forget,
            projects::project_open,
            projects::project_close,
            projects::project_state_get,
            projects::project_state_set,
            projects::default_parent_dir,
            projects::templates::templates_list,
            projects::templates::template_save,
            projects::templates::template_delete,
            projects::templates::template_files,
            projects::templates::template_read,
            projects::templates::template_write,
            projects::templates::template_remove_file,
            projects::templates::template_add_dir,
            projects::templates::template_rename,
            projects::templates::template_set_main,
            projects::templates::template_create,
            fs::fs_list,
            fs::fs_files,
            fs::fs_write_image,
            fs::fs_ensure_dir,
            fs::fs_search,
            fs::fs_create,
            fs::fs_rename,
            fs::fs_transfer,
            fs::fs_trash,
            fs::fs_duplicate,
            fs::fs_reveal,
            fs::fs_read,
            fs::fs_write,
        ])
        .setup(|app| {
            let paths = Paths::resolve(app.handle())?;
            app.manage(Projects::new(&paths.data));
            app.manage(paths);
            engine::status::start_warmup(app.handle().clone());

            app.set_menu(app_menu(app.handle())?)?;
            app.on_menu_event(|app, event| {
                let action = match event.id().as_ref() {
                    "project_new" => "new",
                    "project_folder" => "folder",
                    "project_all" => "all",
                    _ => return,
                };
                let _ = app.emit("project-menu", action);
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let flag = &window.state::<CloseRequested>().0;
                if !flag.swap(true, Ordering::SeqCst) {
                    // Let the frontend flush debounced saves; it destroys the window itself.
                    api.prevent_close();
                    let _ = window.emit("close-requested", ());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building praTexEditOR");

    app.run(|app, event| match event {
        // Cmd+Q / app-menu Quit bypasses the window's CloseRequested: route it through
        // the same flush-then-destroy handshake. code == None means user-initiated.
        RunEvent::ExitRequested {
            api, code: None, ..
        } => {
            if !app.state::<CloseRequested>().0.swap(true, Ordering::SeqCst) {
                api.prevent_exit();
                let _ = app.emit("close-requested", ());
            }
        }
        RunEvent::Exit => app.state::<Procs>().kill_all(),
        _ => {}
    });
}
