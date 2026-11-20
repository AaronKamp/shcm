//! Credentials live only in the OS credential store (Windows Credential
//! Manager, macOS Keychain, Secret Service). The webview can write a secret or
//! ask whether one exists, but can never read one back: reads are Rust-only
//! (`get_secret`), used by the relays that attach credentials upstream.
//!
//! Upstream hosts are stored here too and bound to their credentials: saving a
//! new Home Assistant / UniFi URL wipes that service's token, key and certificate
//! pin, so script running in the webview can't redirect an existing token to a
//! server of its choosing.

use keyring::{Entry, Error as KeyringError};
use serde::Deserialize;

/// Credential Manager "target" prefix; matches the bundle identifier.
const SERVICE: &str = "com.shcm.desktop";
/// Generous upper bound so a paste accident can't stuff megabytes into the store.
const MAX_SECRET_LEN: usize = 8 * 1024;

/// The fixed set of entries the app knows about. Must match `SecretKind` in
/// src/platform/secrets.ts. A closed enum means the webview can't use these
/// commands to touch arbitrary Credential Manager entries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SecretKind {
    GeminiApiKey,
    HomeAssistantUrl,
    HomeAssistantToken,
    UnifiUrl,
    UnifiApiKey,
    UnifiUsername,
    UnifiPassword,
    /// go2rtc base URL (LAN/loopback only): receives camera RTSPS tokens when streams are registered.
    Go2rtcUrl,
    /// TOFU pin of the console's TLS certificate. Rust-internal: not settable from JS.
    #[serde(skip)]
    UnifiCertSha256,
}

impl SecretKind {
    fn account(self) -> &'static str {
        match self {
            SecretKind::GeminiApiKey => "gemini_api_key",
            SecretKind::HomeAssistantUrl => "home_assistant_url",
            SecretKind::HomeAssistantToken => "home_assistant_token",
            SecretKind::UnifiUrl => "unifi_url",
            SecretKind::UnifiApiKey => "unifi_api_key",
            SecretKind::UnifiUsername => "unifi_username",
            SecretKind::UnifiPassword => "unifi_password",
            SecretKind::Go2rtcUrl => "go2rtc_url",
            SecretKind::UnifiCertSha256 => "unifi_cert_sha256",
        }
    }

    /// Credentials that must not survive a change of this entry's upstream host.
    fn dependents(self) -> &'static [SecretKind] {
        match self {
            SecretKind::HomeAssistantUrl => &[SecretKind::HomeAssistantToken],
            SecretKind::UnifiUrl => &[
                SecretKind::UnifiApiKey,
                SecretKind::UnifiUsername,
                SecretKind::UnifiPassword,
                SecretKind::UnifiCertSha256,
            ],
            _ => &[],
        }
    }

    fn validate(self, value: &str) -> Result<(), String> {
        let valid = match self {
            SecretKind::HomeAssistantUrl => crate::ha_relay::to_ws_url(value).is_some(),
            SecretKind::UnifiUrl => crate::unifi::parse_console(value).is_some(),
            SecretKind::Go2rtcUrl => crate::go2rtc::parse_endpoint(value).is_some(),
            _ => true,
        };
        if valid {
            Ok(())
        } else {
            let hint = if self == SecretKind::Go2rtcUrl { " (must be http(s)://<local or LAN host>:<port>)" } else { "" };
            Err(format!("{} is not a valid URL{hint}", self.account()))
        }
    }

    fn entry(self) -> Result<Entry, String> {
        Entry::new(SERVICE, self.account()).map_err(|e| format!("credential store unavailable: {e}"))
    }
}

/// Rust-only read. `Ok(None)` when nothing is stored. Never expose via a command.
pub fn get_secret(kind: SecretKind) -> Result<Option<String>, String> {
    match kind.entry()?.get_password() {
        Ok(v) if !v.is_empty() => Ok(Some(v)),
        Ok(_) | Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(format!("failed to read {}: {e}", kind.account())),
    }
}

/// Rust-only write for internal entries (e.g. the UniFi certificate pin).
pub fn set_internal_secret(kind: SecretKind, value: &str) -> Result<(), String> {
    write(kind, value)
}

fn delete(kind: SecretKind) -> Result<(), String> {
    match kind.entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(format!("failed to clear {}: {e}", kind.account())),
    }
}

fn write(kind: SecretKind, value: &str) -> Result<(), String> {
    // Error text never includes the value.
    kind.entry()?.set_password(value).map_err(|e| format!("failed to save {}: {e}", kind.account()))
}

fn store(kind: SecretKind, value: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.len() > MAX_SECRET_LEN {
        return Err(format!("{} is too long", kind.account()));
    }
    if !trimmed.is_empty() {
        kind.validate(trimmed)?;
    }
    // Store `https://host[:port]` so `http://…/protect` and `https://…` are the same console
    // (and re-entering it in another form doesn't wipe the key and certificate pin).
    let canonical = match kind {
        SecretKind::UnifiUrl if !trimmed.is_empty() => crate::unifi::parse_console(trimmed).map(|c| c.canonical()),
        _ => None,
    };
    let trimmed = canonical.as_deref().unwrap_or(trimmed);
    // A host change (or clearing the host) invalidates everything bound to it.
    if get_secret(kind)?.as_deref() != Some(trimmed) {
        for dep in kind.dependents() {
            delete(*dep)?;
        }
    }
    if trimmed.is_empty() {
        delete(kind)
    } else {
        write(kind, trimmed)
    }
}

/// Saves (or, with an empty string, deletes) an entry. Write-only from JS.
#[tauri::command]
pub async fn set_secret(kind: SecretKind, value: String) -> Result<(), String> {
    // Credential APIs block (and may prompt on Secret Service): keep them off the main thread.
    tauri::async_runtime::spawn_blocking(move || store(kind, &value))
        .await
        .map_err(|e| e.to_string())?
}

/// Whether an entry is stored, without revealing it.
#[tauri::command]
pub async fn has_secret(kind: SecretKind) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || get_secret(kind).map(|v| v.is_some()))
        .await
        .map_err(|e| e.to_string())?
}
