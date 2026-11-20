//! UniFi Protect → go2rtc. Fetches (or creates) a camera's RTSPS streams via the
//! pinned UniFi client, rewrites them for go2rtc, registers them, and returns
//! only opaque go2rtc stream names to the webview. The `rtsps://…:7441/<token>`
//! URLs themselves never leave Rust.

use serde::Serialize;
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::http::Uri;

use crate::go2rtc;
use crate::unifi::{self, UnifiMethod};

const QUALITIES: [&str; 3] = ["high", "medium", "low"];

#[derive(Debug, Serialize)]
pub struct BridgedStream {
    quality: &'static str,
    /// go2rtc stream name, played via `go2rtc_whep`.
    stream: String,
}

/// Ensures go2rtc can serve `camera_id` and returns its WebRTC stream names
/// (best quality first). `recreate` asks UniFi for fresh RTSPS streams.
#[tauri::command]
pub async fn unifi_bridge_streams(camera_id: String, recreate: bool) -> Result<Vec<BridgedStream>, String> {
    if camera_id.is_empty() || camera_id.len() > 64 || !camera_id.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err("Invalid camera id".into());
    }
    // Fail fast (and don't create UniFi streams) when there's nowhere to send them.
    let ep = tauri::async_runtime::spawn_blocking(go2rtc::endpoint).await.map_err(|e| e.to_string())??;

    let path = format!("/cameras/{camera_id}/rtsps-stream");
    let mut urls = if recreate { Vec::new() } else { extract(unifi::call(UnifiMethod::Get, &path, None).await.unwrap_or(Value::Null)) };
    if urls.is_empty() {
        // Not every model offers all three channels; fall back to the main one.
        let created = match unifi::call(UnifiMethod::Post, &path, Some(json!({ "qualities": QUALITIES }))).await {
            Ok(v) => v,
            Err(_) => unifi::call(UnifiMethod::Post, &path, Some(json!({ "qualities": ["high"] }))).await?,
        };
        urls = extract(created);
    }

    let mut out = Vec::new();
    for (quality, url) in urls {
        let Some(src) = to_go2rtc_source(&url) else { continue };
        let stream = format!("shcm_{camera_id}_{quality}");
        go2rtc::put_stream(&ep, &stream, &src).await?;
        out.push(BridgedStream { quality, stream });
    }
    if out.is_empty() {
        return Err("UniFi returned no RTSPS streams for this camera".into());
    }
    Ok(out)
}

/// `{ "high": "rtsps://…", "medium": …, "low": … }` → ordered (quality, url) pairs.
fn extract(body: Value) -> Vec<(&'static str, String)> {
    QUALITIES
        .iter()
        .filter_map(|q| body.get(*q).and_then(Value::as_str).filter(|s| !s.is_empty()).map(|u| (*q, u.to_owned())))
        .collect()
}

/// UniFi serves RTSPS with a self-signed cert and `?enableSrtp`; go2rtc's
/// `rtspx://` is RTSPS without certificate verification, and SRTP must be off.
fn to_go2rtc_source(url: &str) -> Option<String> {
    let uri: Uri = url.parse().ok()?;
    let scheme = match uri.scheme_str()? {
        "rtsps" => "rtspx",
        "rtsp" => "rtsp",
        _ => return None,
    };
    Some(format!("{scheme}://{}{}", uri.authority()?.as_str(), uri.path()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_unifi_rtsps_for_go2rtc() {
        assert_eq!(
            to_go2rtc_source("rtsps://192.168.1.1:7441/AbCdEf123?enableSrtp").as_deref(),
            Some("rtspx://192.168.1.1:7441/AbCdEf123")
        );
        assert_eq!(to_go2rtc_source("rtsp://10.0.0.2:7447/xyz").as_deref(), Some("rtsp://10.0.0.2:7447/xyz"));
        assert_eq!(to_go2rtc_source("https://evil/x"), None);
    }

    #[test]
    fn extracts_streams_best_quality_first() {
        let body = json!({ "low": "rtsps://h:7441/l", "high": "rtsps://h:7441/h", "medium": "" });
        let got: Vec<_> = extract(body).into_iter().map(|(q, _)| q).collect();
        assert_eq!(got, ["high", "low"]);
    }
}
