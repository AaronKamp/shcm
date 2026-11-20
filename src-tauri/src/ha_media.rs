//! Home Assistant media artwork for the webview. HA serves album art and
//! library thumbnails from authenticated, HA-relative paths
//! (`/api/media_player_proxy/…`), which the webview can't load: it has neither
//! HA's address nor the token. `ha_media_image` fetches one such image with the
//! stored token and returns it as a `data:` URL. Only image-proxy paths are
//! accepted, so this can't be used to call the rest of HA's API, and the token
//! and HA URL never reach JS.

use std::time::Duration;

use bytes::Bytes;
use http_body_util::{BodyExt, Empty, Limited};
use hyper::header::{AUTHORIZATION, CONTENT_TYPE, HOST};
use hyper::{Request, Uri};
use hyper_util::rt::TokioIo;
use tokio::net::TcpStream;
use tokio::time::timeout;

use crate::secrets::{get_secret, SecretKind};

const TIMEOUT: Duration = Duration::from_secs(10);
const MAX_IMAGE: usize = 4 * 1024 * 1024;
const MAX_PATH: usize = 2048;

/// HA paths that serve images and nothing else.
const ALLOWED_PREFIXES: &[&str] = &["/api/media_player_proxy/", "/api/image_proxy/", "/api/brands/"];

struct HaBase {
    https: bool,
    host: String,
    port: u16,
    authority: String,
    /// Base path for HA behind a reverse proxy, without trailing slash.
    prefix: String,
}

fn parse_base(raw: &str) -> Option<HaBase> {
    let uri: Uri = raw.trim().parse().ok()?;
    let https = match uri.scheme_str()? {
        "http" | "ws" => false,
        "https" | "wss" => true,
        _ => return None,
    };
    let authority = uri.authority()?;
    if authority.as_str().contains('@') || uri.query().is_some() {
        return None;
    }
    let host = authority.host().trim_start_matches('[').trim_end_matches(']').to_owned();
    let port = authority.port_u16().unwrap_or(if https { 443 } else { 80 });
    let prefix = uri.path().trim_end_matches('/').trim_end_matches("/api/websocket").to_owned();
    Some(HaBase { https, host, port, authority: authority.as_str().to_owned(), prefix })
}

/// An image-proxy path with no traversal, scheme or control characters.
pub(crate) fn valid_image_path(path: &str) -> bool {
    path.len() <= MAX_PATH
        && ALLOWED_PREFIXES.iter().any(|p| path.starts_with(p))
        && !path.contains("..")
        && !path.contains("//")
        && !path.contains('\\')
        && !path.contains('#')
        && path.bytes().all(|b| b.is_ascii_graphic())
}

#[tauri::command]
pub async fn ha_media_image(path: String) -> Result<String, String> {
    if !valid_image_path(&path) {
        return Err("Not a Home Assistant image path".into());
    }
    let creds = tauri::async_runtime::spawn_blocking(|| {
        Ok::<_, String>((get_secret(SecretKind::HomeAssistantUrl)?, get_secret(SecretKind::HomeAssistantToken)?))
    })
    .await
    .map_err(|e| e.to_string())??;
    let (Some(url), Some(token)) = creds else {
        return Err("Home Assistant URL or token not set".into());
    };
    let base = parse_base(&url).ok_or("Home Assistant URL is invalid")?;
    let req = Request::builder()
        .uri(format!("{}{}", base.prefix, path))
        .header(HOST, &base.authority)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Empty::<Bytes>::new())
        .map_err(|_| "Invalid image request".to_string())?;
    drop(token);
    let fut = async {
        let tcp = TcpStream::connect((base.host.as_str(), base.port)).await.map_err(|_| "Could not reach Home Assistant".to_string())?;
        if base.https {
            let tls = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
            let tls = tokio_native_tls::TlsConnector::from(tls)
                .connect(&base.host, tcp)
                .await
                .map_err(|_| "TLS handshake with Home Assistant failed".to_string())?;
            fetch(TokioIo::new(tls), req).await
        } else {
            fetch(TokioIo::new(tcp), req).await
        }
    };
    timeout(TIMEOUT, fut).await.map_err(|_| "Image request timed out".to_string())?
}

async fn fetch<I>(io: I, req: Request<Empty<Bytes>>) -> Result<String, String>
where
    I: hyper::rt::Read + hyper::rt::Write + Unpin + Send + 'static,
{
    let (mut sender, conn) = hyper::client::conn::http1::handshake(io).await.map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn(async move {
        let _ = conn.await;
    });
    let resp = sender.send_request(req).await.map_err(|_| "Image request failed".to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Home Assistant returned HTTP {} for the image", resp.status().as_u16()));
    }
    let ctype = resp
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or("").trim().to_ascii_lowercase())
        .unwrap_or_default();
    // SVG can carry script; only raster formats go back to the webview.
    if !matches!(ctype.as_str(), "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "image/avif") {
        return Err("Home Assistant didn't return an image".into());
    }
    let body = Limited::new(resp.into_body(), MAX_IMAGE)
        .collect()
        .await
        .map_err(|_| "Image too large".to_string())?
        .to_bytes();
    Ok(format!("data:{ctype};base64,{}", base64(&body)))
}

fn base64(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(TABLE[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_image_proxy_paths_are_allowed() {
        assert!(valid_image_path("/api/media_player_proxy/media_player.loft_tv?token=abc&cache=1"));
        assert!(valid_image_path("/api/media_player_proxy/media_player.loft_tv/browse_media/album/1"));
        assert!(!valid_image_path("/api/states"));
        assert!(!valid_image_path("/api/media_player_proxy/../states"));
        assert!(!valid_image_path("//evil.example/api/media_player_proxy/x"));
        assert!(!valid_image_path("http://evil.example/api/media_player_proxy/x"));
        assert!(!valid_image_path("/api/media_player_proxy/x y"));
    }

    #[test]
    fn base_keeps_reverse_proxy_prefix() {
        let b = parse_base("https://example.com:8443/ha/").unwrap();
        assert_eq!((b.https, b.port, b.prefix.as_str()), (true, 8443, "/ha"));
        assert!(parse_base("http://user@host:8123").is_none());
    }

    #[test]
    fn base64_matches_rfc4648() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }
}
