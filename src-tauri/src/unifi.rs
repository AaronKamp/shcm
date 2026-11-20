//! UniFi Protect Integration API, called from Rust so the `X-API-KEY` never
//! reaches the webview. REST traffic is low-frequency (30s polls), so it goes
//! over `invoke` rather than the WebSocket relay.
//!
//! Consoles ship self-signed certificates. Instead of blindly trusting any
//! certificate (which would hand the key to any LAN MITM), the first successful
//! TLS handshake pins the console's leaf certificate (SHA-256), and every later
//! request verifies that pin *before* the API key is written to the socket.
//! Re-saving the console URL clears the pin (see secrets.rs).

use std::time::Duration;

use bytes::Bytes;
use http_body_util::{BodyExt, Full, Limited};
use hyper::header::{ACCEPT, CONTENT_TYPE, HOST};
use hyper::Uri;
use hyper_util::rt::TokioIo;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::net::TcpStream;
use tokio::time::timeout;

use crate::secrets::{get_secret, set_internal_secret, SecretKind};

const API_PREFIX: &str = "/proxy/protect/integration/v1";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_BODY: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum UnifiMethod {
    Get,
    Post,
}

/// Console address parsed from the stored URL (`https://192.168.1.1[:port]`).
pub(crate) struct Console {
    host: String,
    port: u16,
    authority: String,
}

/// Calls `GET|POST /proxy/protect/integration/v1<path>` and returns the JSON body.
/// RTSPS stream endpoints are excluded: their URLs embed camera access tokens and
/// are handled entirely in Rust by `unifi_streams.rs`.
#[tauri::command]
pub async fn unifi_request(method: UnifiMethod, path: String, body: Option<Value>) -> Result<Value, String> {
    validate_path(&path)?;
    call(method, &path, body).await
}

/// Rust-internal API call (no webview path restrictions beyond the caller's own).
pub(crate) async fn call(method: UnifiMethod, path: &str, body: Option<Value>) -> Result<Value, String> {
    let (url, key, pin) = tauri::async_runtime::spawn_blocking(|| {
        Ok::<_, String>((
            get_secret(SecretKind::UnifiUrl)?,
            get_secret(SecretKind::UnifiApiKey)?,
            get_secret(SecretKind::UnifiCertSha256)?,
        ))
    })
    .await
    .map_err(|e| e.to_string())??;
    let (Some(url), Some(key)) = (url, key) else {
        return Err("UniFi console URL or API key not set".into());
    };
    let console = parse_console(&url).ok_or("UniFi console URL is invalid")?;
    timeout(REQUEST_TIMEOUT, request(&console, &key, pin, method, path, body))
        .await
        .map_err(|_| "UniFi console request timed out".to_string())?
}

async fn request(
    console: &Console,
    key: &str,
    pin: Option<String>,
    method: UnifiMethod,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let tcp = TcpStream::connect((console.host.as_str(), console.port))
        .await
        .map_err(|_| "Could not reach the UniFi console".to_string())?;
    // Chain/hostname checks are replaced by the certificate pin below.
    let is_ip = console.host.parse::<std::net::IpAddr>().is_ok();
    let tls_config = native_tls::TlsConnector::builder()
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .use_sni(!is_ip)
        .build()
        .map_err(|e| format!("TLS setup failed: {e}"))?;
    let tls = tokio_native_tls::TlsConnector::from(tls_config)
        .connect(&console.host, tcp)
        .await
        .map_err(|_| "TLS handshake with the UniFi console failed".to_string())?;

    let cert = tls.get_ref().peer_certificate().ok().flatten().ok_or("UniFi console sent no certificate")?;
    let fingerprint = sha256_hex(&cert.to_der().map_err(|e| e.to_string())?);
    match pin {
        Some(p) if p != fingerprint => {
            return Err("UniFi console certificate changed. Re-save the console URL to trust the new certificate.".into())
        }
        Some(_) => {}
        None => {
            let fp = fingerprint.clone();
            tauri::async_runtime::spawn_blocking(move || set_internal_secret(SecretKind::UnifiCertSha256, &fp))
                .await
                .map_err(|e| e.to_string())??;
        }
    }

    // Pin verified on this exact connection: only now is the key written.
    let (mut sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(tls))
        .await
        .map_err(|e| format!("HTTP handshake failed: {e}"))?;
    tauri::async_runtime::spawn(async move {
        let _ = conn.await;
    });
    let payload = match body {
        Some(v) => serde_json::to_vec(&v).map_err(|e| e.to_string())?,
        None => Vec::new(),
    };
    let method_name = match method {
        UnifiMethod::Get => "GET",
        UnifiMethod::Post => "POST",
    };
    let req = hyper::Request::builder()
        .method(method_name)
        .uri(format!("{API_PREFIX}{path}"))
        .header(HOST, &console.authority)
        .header("X-API-KEY", key)
        .header(ACCEPT, "application/json")
        .header(CONTENT_TYPE, "application/json")
        .body(Full::new(Bytes::from(payload)))
        .map_err(|e| e.to_string())?;
    let resp = sender.send_request(req).await.map_err(|_| "UniFi console request failed".to_string())?;
    let status = resp.status();
    let bytes = Limited::new(resp.into_body(), MAX_BODY)
        .collect()
        .await
        .map_err(|_| "UniFi console response too large or truncated".to_string())?
        .to_bytes();
    if !status.is_success() {
        return Err(format!("UniFi Protect {method_name} {path} → HTTP {}", status.as_u16()));
    }
    if bytes.is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_slice(&bytes).map_err(|_| "UniFi console returned invalid JSON".into())
}

/// Integration-API sub-paths only: `/cameras`, `/cameras/<id>/rtsps-stream`, …
fn validate_path(path: &str) -> Result<(), String> {
    let ok = path.starts_with('/')
        && path.len() <= 256
        && !path.contains("..")
        && !path.contains("//")
        && !path.contains("rtsps-stream")
        && path.bytes().all(|b| b.is_ascii_alphanumeric() || b"/-_.".contains(&b));
    if ok {
        Ok(())
    } else {
        Err("Invalid UniFi API path".into())
    }
}

/// Accepts the console address the way users copy it from the browser:
/// `https://host[:port]`, `http://host`, optionally followed by a Protect UI path
/// (`/protect`, `/protect/dashboard`, …). UniFi OS only serves the API over HTTPS
/// (plain HTTP just redirects), so `http://` is upgraded and the API key is never
/// sent in cleartext. No credentials or query allowed.
pub(crate) fn parse_console(raw: &str) -> Option<Console> {
    let uri: Uri = raw.trim().trim_end_matches('/').parse().ok()?;
    let path = uri.path();
    let ui_path = matches!(path, "" | "/" | "/protect") || path.starts_with("/protect/");
    if uri.query().is_some() || !ui_path {
        return None;
    }
    let authority = uri.authority()?;
    if authority.as_str().contains('@') {
        return None;
    }
    let port = match (uri.scheme_str()?, authority.port_u16()) {
        ("https", p) => p.unwrap_or(443),
        // An explicit http port isn't the HTTPS port: refuse rather than guess.
        ("http", None) => 443,
        _ => return None,
    };
    let host = authority.host().trim_start_matches('[').trim_end_matches(']').to_owned();
    let authority = if port == 443 { authority.host().to_owned() } else { format!("{}:{port}", authority.host()) };
    Some(Console { host, port, authority })
}

impl Console {
    /// Normalized form that is stored: `https://host[:port]`.
    pub(crate) fn canonical(&self) -> String {
        format!("https://{}", self.authority)
    }
}

fn sha256_hex(der: &[u8]) -> String {
    Sha256::digest(der).iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_are_restricted_to_the_integration_api() {
        assert!(validate_path("/cameras").is_ok());
        assert!(validate_path("/cameras/abc123").is_ok());
        // Stream URLs carry camera tokens: only the Rust bridge may fetch them.
        assert!(validate_path("/cameras/abc123/rtsps-stream").is_err());
        assert!(validate_path("/../network/api").is_err());
        assert!(validate_path("cameras").is_err());
        assert!(validate_path("/cameras?x=1").is_err());
        assert!(validate_path("//evil.example/x").is_err());
    }

    #[test]
    fn console_urls_normalize_to_https_origin() {
        let c = parse_console("https://192.168.1.1/").unwrap();
        assert_eq!((c.host.as_str(), c.port), ("192.168.1.1", 443));
        assert_eq!(parse_console("https://unvr.local:8443").unwrap().canonical(), "https://unvr.local:8443");
        // Copied from the browser address bar: upgraded to HTTPS, UI path dropped.
        for raw in ["http://192.168.1.1/protect", "http://192.168.1.1", "https://192.168.1.1/protect/dashboard/"] {
            assert_eq!(parse_console(raw).unwrap().canonical(), "https://192.168.1.1", "{raw}");
        }
        assert!(parse_console("http://192.168.1.1:8080").is_none());
        assert!(parse_console("https://user:pw@192.168.1.1").is_none());
        assert!(parse_console("https://192.168.1.1/proxy").is_none());
        assert!(parse_console("https://192.168.1.1/protectx").is_none());
        assert!(parse_console("ftp://192.168.1.1").is_none());
    }
}
