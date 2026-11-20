//! User-configurable global shortcuts (overlay toggle, hold-to-talk). Saved to
//! `shortcuts.json` in the app config dir; changing one re-registers it with
//! the OS and tells every window (`shcm://shortcuts`) so labels and the
//! in-window hold-to-talk combo follow.

use std::path::PathBuf;
use std::str::FromStr;
use std::sync::{LazyLock, RwLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

pub const DEFAULT_OVERLAY: &str = "Ctrl+Shift+Space";
pub const DEFAULT_PTT: &str = "Ctrl+Alt+Space";
/// Must match `SHORTCUTS_EVENT` in src/state/shortcutStore.ts.
const SHORTCUTS_EVENT: &str = "shcm://shortcuts";
const FILE: &str = "shortcuts.json";

/// Accelerators as shown to the user, e.g. "Ctrl+Shift+Space".
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Debug)]
pub struct Shortcuts {
    pub overlay: String,
    pub ptt: String,
}

impl Default for Shortcuts {
    fn default() -> Self {
        Self { overlay: DEFAULT_OVERLAY.into(), ptt: DEFAULT_PTT.into() }
    }
}

static CURRENT: LazyLock<RwLock<Shortcuts>> = LazyLock::new(|| RwLock::new(Shortcuts::default()));

pub fn parse(accel: &str) -> Option<Shortcut> {
    Shortcut::from_str(accel).ok()
}

fn current() -> Shortcuts {
    CURRENT.read().map(|s| s.clone()).unwrap_or_default()
}

pub fn is_overlay(sc: &Shortcut) -> bool {
    parse(&current().overlay).is_some_and(|s| &s == sc)
}

pub fn is_ptt(sc: &Shortcut) -> bool {
    parse(&current().ptt).is_some_and(|s| &s == sc)
}

fn path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join(FILE))
}

/// Saved shortcuts, falling back to the defaults for anything missing or unparsable.
fn load_saved<R: Runtime>(app: &AppHandle<R>) -> Shortcuts {
    let saved = path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str::<Shortcuts>(&t).ok())
        .unwrap_or_default();
    let ok = |s: &str, d: &str| if parse(s).is_some() { s.to_owned() } else { d.to_owned() };
    let s = Shortcuts { overlay: ok(&saved.overlay, DEFAULT_OVERLAY), ptt: ok(&saved.ptt, DEFAULT_PTT) };
    if s.overlay == s.ptt { Shortcuts::default() } else { s }
}

/// Startup: load and register both. A combo another app owns is reported, not fatal.
pub fn register_saved<R: Runtime>(app: &AppHandle<R>) {
    let s = load_saved(app);
    for (name, accel) in [("overlay", &s.overlay), ("push-to-talk", &s.ptt)] {
        if let Some(sc) = parse(accel) {
            if let Err(err) = app.global_shortcut().register(sc) {
                eprintln!("[shcm] {name} shortcut {accel} unavailable: {err}");
            }
        }
    }
    if let Ok(mut cur) = CURRENT.write() {
        *cur = s;
    }
}

/// Backup: the saved shortcuts file as text, if any.
pub fn export_raw<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    path(app).and_then(|p| std::fs::read_to_string(p).ok())
}

/// Backup restore: writes the file (if it parses), re-registers both combos and tells every window.
pub fn import_raw<R: Runtime>(app: &AppHandle<R>, json: &str) -> Result<(), String> {
    let parsed: Shortcuts = serde_json::from_str(json).map_err(|_| "Backup has unreadable shortcuts".to_owned())?;
    let p = path(app).ok_or("No config folder for shortcuts")?;
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let text = serde_json::to_string_pretty(&parsed).map_err(|e| e.to_string())?;
    std::fs::write(&p, text).map_err(|e| format!("Couldn't save shortcuts: {e}"))?;
    let _ = app.global_shortcut().unregister_all();
    register_saved(app);
    let _ = app.emit(SHORTCUTS_EVENT, current());
    Ok(())
}

#[tauri::command]
pub fn get_shortcuts() -> Shortcuts {
    current()
}

/// Rebinds `action` ("overlay" | "ptt") to `accelerator`. On failure the old binding stays.
#[tauri::command]
pub fn set_shortcut<R: Runtime>(app: AppHandle<R>, action: String, accelerator: String) -> Result<Shortcuts, String> {
    let new = parse(&accelerator).ok_or("That key combination isn't supported")?;
    let mut next = current();
    let (old, other) = match action.as_str() {
        "overlay" => (std::mem::replace(&mut next.overlay, accelerator.clone()), next.ptt.clone()),
        "ptt" => (std::mem::replace(&mut next.ptt, accelerator.clone()), next.overlay.clone()),
        _ => return Err("Unknown shortcut".into()),
    };
    if parse(&other).is_some_and(|o| o == new) {
        return Err("The other shortcut already uses that combination".into());
    }
    let gs = app.global_shortcut();
    let old_sc = parse(&old);
    if old_sc.as_ref() != Some(&new) {
        if let Some(o) = &old_sc {
            let _ = gs.unregister(*o);
        }
        if let Err(err) = gs.register(new) {
            if let Some(o) = old_sc {
                let _ = gs.register(o);
            }
            return Err(format!("Couldn't use {accelerator}; another app may own it ({err})"));
        }
    }
    if let Some(p) = path(&app) {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let json = serde_json::to_string_pretty(&next).map_err(|e| e.to_string())?;
        std::fs::write(&p, json).map_err(|e| format!("Couldn't save shortcuts: {e}"))?;
    }
    if let Ok(mut cur) = CURRENT.write() {
        *cur = next.clone();
    }
    let _ = app.emit(SHORTCUTS_EVENT, next.clone());
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_parse_and_differ() {
        assert!(parse(DEFAULT_OVERLAY).is_some());
        assert!(parse(DEFAULT_PTT).is_some());
        assert_ne!(parse(DEFAULT_OVERLAY), parse(DEFAULT_PTT));
    }

    #[test]
    fn display_format_round_trips() {
        assert!(parse("Ctrl+Alt+K").is_some());
        assert!(parse("Ctrl+Shift+F9").is_some());
        assert!(parse("Ctrl+Shift+5").is_some());
        assert!(parse("Nonsense+Key").is_none());
    }
}
