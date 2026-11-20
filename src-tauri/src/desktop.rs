//! Windows/macOS/Linux shell: system tray, global overlay shortcut, and
//! hide-to-tray. Every show/hide/minimize emits `shcm://visibility` so the
//! webview can tear down video streams (WebView2 doesn't reliably flip
//! `document.visibilityState` on `window.hide()`).

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Builder, Emitter, Manager, Runtime, WindowEvent,
};
use tauri_plugin_global_shortcut::ShortcutState;

const MAIN: &str = "main";
const OVERLAY: &str = "overlay";
const VISIBILITY_EVENT: &str = "shcm://visibility";

/// Must match `VisibilityPayload` in src/platform/window.ts.
#[derive(Clone, Serialize)]
struct VisibilityPayload<'a> {
    label: &'a str,
    visible: bool,
}

fn emit_visibility<R: Runtime>(app: &AppHandle<R>, label: &str, visible: bool) {
    let _ = app.emit(VISIBILITY_EVENT, VisibilityPayload { label, visible });
}

fn set_visible<R: Runtime>(app: &AppHandle<R>, label: &str, visible: bool) {
    let Some(win) = app.get_webview_window(label) else { return };
    if visible {
        // Tell the webview first so streams start connecting while the window paints.
        emit_visibility(app, label, true);
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    } else {
        // Pause streams before hiding so no frames decode for an invisible window.
        emit_visibility(app, label, false);
        let _ = win.hide();
    }
}

fn toggle<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Some(win) = app.get_webview_window(label) {
        let shown = win.is_visible().unwrap_or(false) && !win.is_minimized().unwrap_or(false);
        set_visible(app, label, !shown);
    }
}

/// Hold-to-talk. Must match `PTT_EVENT` in src/ui/voice/usePushToTalk.ts.
const PTT_EVENT: &str = "shcm://ptt";

#[derive(Clone, Serialize)]
struct PttPayload {
    pressed: bool,
}

/// Press summons the overlay (which owns the global voice session) and opens
/// the mic; release closes it. The webview treats repeats idempotently.
fn push_to_talk<R: Runtime>(app: &AppHandle<R>, pressed: bool) {
    if pressed {
        set_visible(app, OVERLAY, true);
    }
    let _ = app.emit_to(OVERLAY, PTT_EVENT, PttPayload { pressed });
}

/// Wake word heard. Must match `WAKE_EVENT` / `WakePayload` in src/ui/voice/useWakeWord.ts.
const WAKE_EVENT: &str = "shcm://wake";

#[derive(Clone, Serialize)]
struct WakePayload<'a> {
    label: &'a str,
}

/// The dashboard's detector heard the wake word. A focused dashboard answers
/// itself; otherwise the overlay pops up (like push-to-talk) and answers.
#[tauri::command]
fn voice_wake<R: Runtime>(app: AppHandle<R>) {
    let main_focused = app.get_webview_window(MAIN).is_some_and(|w| {
        w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false) && w.is_focused().unwrap_or(false)
    });
    let label = if main_focused {
        MAIN
    } else {
        set_visible(&app, OVERLAY, true);
        OVERLAY
    };
    let _ = app.emit(WAKE_EVENT, WakePayload { label });
}

pub fn configure<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    builder
        .plugin(tauri_plugin_dialog::init())
        .manage(crate::photos::PhotoIndex::default())
        .manage(crate::backup::BackupState::default())
        .register_asynchronous_uri_scheme_protocol(crate::photos::SCHEME, |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            // Photos can be large or still downloading from OneDrive: read off the main thread.
            tauri::async_runtime::spawn_blocking(move || responder.respond(crate::photos::serve(&app, &request)));
        })
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    let pressed = event.state() == ShortcutState::Pressed;
                    if crate::shortcuts::is_ptt(shortcut) {
                        push_to_talk(app, pressed);
                    } else if pressed && crate::shortcuts::is_overlay(shortcut) {
                        toggle(app, OVERLAY);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            crate::secrets::set_secret,
            crate::secrets::has_secret,
            crate::relay_server::get_gemini_proxy_url,
            crate::relay_server::get_home_assistant_relay_url,
            crate::unifi::unifi_request,
            crate::unifi_streams::unifi_bridge_streams,
            crate::go2rtc::go2rtc_whep,
            crate::ha_media::ha_media_image,
            crate::shortcuts::get_shortcuts,
            crate::shortcuts::set_shortcut,
            crate::relay_server::get_go2rtc_mse_url,
            voice_wake,
            crate::photos::photo_list,
            crate::photos::photo_suggested_folders,
            crate::backup::backup_export,
            crate::backup::backup_pick,
            crate::backup::backup_import,
            crate::backup::backup_reload_windows,
        ])
        .setup(|app| {
            crate::relay_server::start(app.handle());
            // Another app may own a combo; the overlay is still in the tray menu, voice has the wake button.
            crate::shortcuts::register_saved(app.handle());

            let show = MenuItem::with_id(app, "show", "Open Dashboard", true, None::<&str>)?;
            let overlay = MenuItem::with_id(app, "overlay", "Toggle Overlay", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "Hide to Tray", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &overlay, &hide, &quit])?;

            let mut tray = TrayIconBuilder::with_id("shcm-tray")
                .tooltip("Smart Home Command")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => set_visible(app, MAIN, true),
                    "overlay" => toggle(app, OVERLAY),
                    "hide" => {
                        set_visible(app, MAIN, false);
                        set_visible(app, OVERLAY, false);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        toggle(tray.app_handle(), MAIN);
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            let app = window.app_handle();
            let label = window.label();
            match event {
                // Closing any window hides it to tray; Quit lives in the tray menu.
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    set_visible(app, label, false);
                }
                // Minimize arrives as a resize on Windows.
                WindowEvent::Resized(_) => {
                    let minimized = window.is_minimized().unwrap_or(false);
                    let shown = window.is_visible().unwrap_or(false);
                    emit_visibility(app, label, shown && !minimized);
                }
                // The overlay behaves like a launcher: clicking elsewhere dismisses it.
                WindowEvent::Focused(false) if label == OVERLAY => set_visible(app, OVERLAY, false),
                _ => {}
            }
        })
}
