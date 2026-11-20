//! Passphrase-encrypted backup of everything needed to set up another device:
//! UI settings (handed over by the webview), shortcuts, and the credential store.
//!
//! Credentials are read and written here only; they never reach the webview.
//! Both file dialogs are native and opened from Rust, so script in the webview
//! can't choose where a backup is written or read from. Any drive works (USB,
//! OneDrive, a network share), and one file can be restored on many devices.
//! Encryption lives in `backup_crypto`.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_dialog::DialogExt;
use zeroize::Zeroizing;

use crate::backup_crypto::{decrypt, encrypt};

const EXTENSION: &str = "shcmbackup";
/// Settings can hold a data-URL "now playing" image; anything bigger isn't ours.
const MAX_FILE: u64 = 64 * 1024 * 1024;
const MIN_PASSPHRASE: usize = 8;

#[derive(Default)]
pub struct BackupState {
    /// File chosen by `backup_pick`, so a mistyped passphrase can be retried without re-picking.
    picked: Mutex<Option<PathBuf>>,
}

#[derive(Serialize, Deserialize)]
struct Secret {
    account: String,
    value: String,
}

#[derive(Serialize, Deserialize)]
struct Contents {
    format: String,
    version: u32,
    created: u64,
    app_version: String,
    /// localStorage entries (`shcm.*`).
    settings: BTreeMap<String, String>,
    shortcuts: Option<String>,
    secrets: Vec<Secret>,
}

/// Must match `BackupExported` in src/platform/backup.ts.
#[derive(Serialize)]
pub struct Exported {
    file_name: String,
    settings: usize,
    secrets: usize,
}

/// Must match `BackupRestored` in src/platform/backup.ts.
#[derive(Serialize)]
pub struct Restored {
    settings: BTreeMap<String, String>,
    secrets: usize,
    shortcuts: bool,
    /// Unix seconds when the backup was made.
    created: u64,
}

fn valid_setting_key(k: &str) -> bool {
    k.starts_with("shcm.") && k.len() <= 64 && k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-')
}

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Default name offered in the save dialog; the user can change it there.
fn suggested_name(stamp: &str) -> String {
    let clean: String = stamp.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(20).collect();
    if clean.is_empty() {
        format!("SHCM backup.{EXTENSION}")
    } else {
        format!("SHCM backup {clean}.{EXTENSION}")
    }
}

fn file_name(p: &std::path::Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

fn export_blocking<R: Runtime>(app: &AppHandle<R>, passphrase: &str, settings: BTreeMap<String, String>, stamp: &str) -> Result<Option<Exported>, String> {
    if passphrase.chars().count() < MIN_PASSPHRASE {
        return Err(format!("Use a passphrase of at least {MIN_PASSPHRASE} characters"));
    }
    let settings: BTreeMap<String, String> = settings.into_iter().filter(|(k, _)| valid_setting_key(k)).collect();
    let secrets: Vec<Secret> = crate::secrets::export_all()?.into_iter().map(|(account, value)| Secret { account, value }).collect();
    let contents = Contents {
        format: "shcm-backup".into(),
        version: 1,
        created: now_secs(),
        app_version: app.package_info().version.to_string(),
        settings,
        shortcuts: crate::shortcuts::export_raw(app),
        secrets,
    };
    let plain = Zeroizing::new(serde_json::to_vec(&contents).map_err(|e| e.to_string())?);
    let sealed = encrypt(passphrase, &plain)?;
    let Some(target) = app
        .dialog()
        .file()
        .set_title("Save Smart Home Command backup")
        .set_file_name(suggested_name(stamp))
        .add_filter("Smart Home Command backup", &[EXTENSION])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = target.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, sealed).map_err(|e| format!("Couldn't write the backup: {e}"))?;
    Ok(Some(Exported { file_name: file_name(&path), settings: contents.settings.len(), secrets: contents.secrets.len() }))
}

/// Encrypts settings + shortcuts + credentials, then asks where to save. `None` = cancelled.
#[tauri::command]
pub async fn backup_export<R: Runtime>(app: AppHandle<R>, passphrase: String, settings: BTreeMap<String, String>, stamp: String) -> Result<Option<Exported>, String> {
    let passphrase = Zeroizing::new(passphrase);
    tauri::async_runtime::spawn_blocking(move || export_blocking(&app, &passphrase, settings, &stamp))
        .await
        .map_err(|e| e.to_string())?
}

/// Native open dialog. Returns the chosen file's name; `None` = cancelled.
#[tauri::command]
pub async fn backup_pick<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    let handle = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        handle
            .dialog()
            .file()
            .set_title("Choose a Smart Home Command backup")
            .add_filter("Smart Home Command backup", &[EXTENSION])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(fp) = picked else { return Ok(None) };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    let name = file_name(&path);
    *app.state::<BackupState>().picked.lock().map_err(|e| e.to_string())? = Some(path);
    Ok(Some(name))
}

fn import_blocking<R: Runtime>(app: &AppHandle<R>, path: PathBuf, passphrase: &str) -> Result<Restored, String> {
    let len = std::fs::metadata(&path).map_err(|e| format!("Couldn't open the backup: {e}"))?.len();
    if len > MAX_FILE {
        return Err("That file is too large to be a backup".into());
    }
    let file = std::fs::read(&path).map_err(|e| format!("Couldn't read the backup: {e}"))?;
    let plain = decrypt(passphrase, &file)?;
    let contents: Contents = serde_json::from_slice(&plain).map_err(|_| "The backup's contents are unreadable".to_owned())?;
    if contents.format != "shcm-backup" || contents.version != 1 {
        return Err("This backup was made by a newer version of the app".into());
    }
    let pairs: Vec<(String, String)> = contents.secrets.into_iter().map(|s| (s.account, s.value)).collect();
    let secrets = crate::secrets::import_all(&pairs)?;
    drop(pairs);
    let shortcuts = match contents.shortcuts.as_deref() {
        Some(json) => crate::shortcuts::import_raw(app, json).is_ok(),
        None => false,
    };
    let settings = contents.settings.into_iter().filter(|(k, _)| valid_setting_key(k)).collect();
    Ok(Restored { settings, secrets, shortcuts, created: contents.created })
}

/// Decrypts the picked file, restores credentials and shortcuts here, and returns
/// the UI settings for the webview to apply. Credentials are not returned.
#[tauri::command]
pub async fn backup_import<R: Runtime>(app: AppHandle<R>, state: State<'_, BackupState>, passphrase: String) -> Result<Restored, String> {
    let path = state.picked.lock().map_err(|e| e.to_string())?.clone().ok_or("Choose a backup file first")?;
    let passphrase = Zeroizing::new(passphrase);
    tauri::async_runtime::spawn_blocking(move || import_blocking(&app, path, &passphrase))
        .await
        .map_err(|e| e.to_string())?
}

/// After the webview has written restored settings: reload every window so all of it takes effect.
#[tauri::command]
pub fn backup_reload_windows<R: Runtime>(app: AppHandle<R>) {
    for w in app.webview_windows().values() {
        let _ = w.reload();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reads (never writes) the real credential store. Run by hand: `cargo test --lib live_store -- --ignored`.
    #[test]
    #[ignore]
    fn live_store_survives_a_round_trip() {
        let secrets = crate::secrets::export_all().unwrap();
        let contents = Contents {
            format: "shcm-backup".into(),
            version: 1,
            created: now_secs(),
            app_version: "test".into(),
            settings: BTreeMap::from([("shcm.test.v1".to_owned(), "{}".to_owned())]),
            shortcuts: None,
            secrets: secrets.iter().map(|(a, v)| Secret { account: a.clone(), value: v.clone() }).collect(),
        };
        let sealed = encrypt("live test passphrase", &serde_json::to_vec(&contents).unwrap()).unwrap();
        let back: Contents = serde_json::from_slice(&decrypt("live test passphrase", &sealed).unwrap()).unwrap();
        let same = back.secrets.len() == secrets.len() && back.secrets.iter().zip(&secrets).all(|(b, (a, v))| &b.account == a && &b.value == v);
        println!("credentials in store: {}; all identical after decrypt: {same}; file bytes: {}", secrets.len(), sealed.len());
        println!("accounts: {:?}", secrets.iter().map(|(a, _)| a.as_str()).collect::<Vec<_>>());
        assert!(same);
    }

    #[test]
    fn setting_keys_are_limited_to_the_app() {
        assert!(valid_setting_key("shcm.layout.v1"));
        assert!(!valid_setting_key("other.key"));
        assert!(!valid_setting_key("shcm.../../x"));
        assert_eq!(suggested_name("2026-11-20"), "SHCM backup 2026-11-20.shcmbackup");
        assert_eq!(suggested_name("../\\"), "SHCM backup.shcmbackup");
    }
}
