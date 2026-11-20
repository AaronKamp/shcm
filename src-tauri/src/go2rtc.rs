//! go2rtc bridge: restreams UniFi RTSPS as WebRTC the webview can play.
//!
//! * Streams are registered from Rust (`PUT /api/streams`) so RTSPS URLs, which
//!   embed per-camera access tokens, never reach JS.
//! * WHEP signaling (`POST /api/webrtc?src=…`) is proxied by `go2rtc_whep`, which
//!   avoids CORS/mixed-content; the media itself flows go2rtc → webview over
//!   WebRTC (UDP/TCP), never through IPC.
//! * The go2rtc URL lives in the credential store and must be a loopback/LAN
//!   host, so script in the webview can't redirect camera tokens off-network.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use bytes::Bytes;
use http_body_util::{BodyExt, Full, Limited};
use hyper::header::{CONTENT_TYPE, HOST};
use hyper::{Method, Request, StatusCode, Uri};
use hyper_util::rt::TokioIo;
use tokio::net::TcpStream;
use tokio::time::timeout;

use tokio_tungstenite::connect_async;

use crate::relay_server::{pipe, reject, ClientWs};
use crate::secrets::{get_secret, SecretKind};

const TIMEOUT: Duration = Duration::from_secs(10);
/// MSE relay close codes (see `MSE_CLOSE` in src/ui/video/mse.ts).
const CLOSE_NOT_CONFIGURED: u16 = 4020;
const CLOSE_UPSTREAM: u16 = 4021;
const MAX_BODY: usize = 256 * 1024;
const MAX_SDP: usize = 64 * 1024;

/// Stream name → go2rtc source, so a go2rtc restart (which drops API-added
/// streams) heals on the next WHEP attempt. Rust memory only.
static REGISTERED: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

pub(crate) struct Endpoint {
    https: bool,
    host: String,
    port: u16,
    authority: String,
}

/// `http(s)://host[:port]` where host is loopback, private/link-local, or a LAN name.
pub(crate) fn parse_endpoint(raw: &str) -> Option<Endpoint> {
    let uri: Uri = raw.trim().trim_end_matches('/').parse().ok()?;
    let https = match uri.scheme_str()? {
        "http" => false,
        "https" => true,
        _ => return None,
    };
    if uri.query().is_some() || !matches!(uri.path(), "" | "/") {
        return None;
    }
    let authority = uri.authority()?;
    if authority.as_str().contains('@') {
        return None;
    }
    let host = authority.host().trim_start_matches('[').trim_end_matches(']').to_owned();
    if !is_local_host(&host) {
        return None;
    }
    let port = authority.port_u16().unwrap_or(if https { 443 } else { 80 });
    Some(Endpoint { https, host, port, authority: authority.as_str().to_owned() })
}

fn is_local_host(host: &str) -> bool {
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => ip.is_loopback() || ip.is_private() || ip.is_link_local(),
        Ok(IpAddr::V6(ip)) => {
            let seg = ip.segments()[0];
            ip.is_loopback() || (seg & 0xfe00) == 0xfc00 || (seg & 0xffc0) == 0xfe80
        }
        Err(_) => {
            let h = host.to_ascii_lowercase();
            h == "localhost"
                || !h.contains('.')
                || [".local", ".lan", ".home.arpa", ".internal"].iter().any(|s| h.ends_with(s))
        }
    }
}

pub(crate) fn endpoint() -> Result<Endpoint, String> {
    let url = get_secret(SecretKind::Go2rtcUrl)?.ok_or("go2rtc URL not set (Integrations → Video bridge)")?;
    parse_endpoint(&url).ok_or_else(|| "go2rtc URL is invalid".into())
}

/// Stream names we create or accept from the webview: `[A-Za-z0-9_-]{1,96}`.
pub(crate) fn valid_stream_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 96 && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// go2rtc saves every `PUT /api/streams` into its YAML config. Two at once
/// (the dashboard and overlay windows both registering after a reload) can
/// write the same stream twice, after which go2rtc rejects every later save.
/// So registrations go one at a time, across all windows.
static PUT_LOCK: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(|| tokio::sync::Mutex::new(()));

/// Registers a go2rtc stream unless this app already registered it with the
/// same source. `src` is never logged or returned.
pub(crate) async fn put_stream(ep: &Endpoint, name: &str, src: &str) -> Result<(), String> {
    let _guard = PUT_LOCK.lock().await;
    let known = REGISTERED.lock().map_err(|e| e.to_string())?.get(name).is_some_and(|s| s == src);
    if known {
        return Ok(());
    }
    put_stream_locked(ep, name, src).await
}

/// Registers again even if cached: go2rtc lost the stream (e.g. it restarted).
async fn reput_stream(ep: &Endpoint, name: &str, src: &str) -> Result<(), String> {
    let _guard = PUT_LOCK.lock().await;
    put_stream_locked(ep, name, src).await
}

async fn put_stream_locked(ep: &Endpoint, name: &str, src: &str) -> Result<(), String> {
    let path = format!("/api/streams?name={}&src={}", encode(name), encode(src));
    let (status, body) = send(ep, Method::PUT, &path, Bytes::new(), None).await?;
    if !status.is_success() {
        // e.g. "yaml: line 10: …" when go2rtc can't save its config.
        return Err(format!("go2rtc refused stream registration (HTTP {}){}", status.as_u16(), reason(&body)));
    }
    REGISTERED.lock().map_err(|e| e.to_string())?.insert(name.to_owned(), src.to_owned());
    Ok(())
}

/// WHEP offer → answer for a go2rtc stream, re-registering once if go2rtc lost it.
#[tauri::command]
pub async fn go2rtc_whep(stream: String, offer: String) -> Result<String, String> {
    if !valid_stream_name(&stream) || offer.len() > MAX_SDP || !offer.starts_with("v=0") {
        return Err("Invalid WHEP request".into());
    }
    let ep = tauri::async_runtime::spawn_blocking(endpoint).await.map_err(|e| e.to_string())??;
    whep(&ep, &stream, offer).await
}

async fn whep(ep: &Endpoint, stream: &str, offer: String) -> Result<String, String> {
    let path = format!("/api/webrtc?src={}", encode(stream));
    let offer = Bytes::from(offer);
    let mut attempt = send(ep, Method::POST, &path, offer.clone(), Some("application/sdp")).await?;
    if !attempt.0.is_success() {
        let cached = REGISTERED.lock().map_err(|e| e.to_string())?.get(stream).cloned();
        if let Some(src) = cached {
            reput_stream(ep, stream, &src).await?;
            attempt = send(ep, Method::POST, &path, offer, Some("application/sdp")).await?;
        }
    }
    let (status, body) = attempt;
    if !status.is_success() {
        // e.g. "codecs not matched: … video:H265 => …" or "read tcp …:7441: i/o timeout".
        return Err(format!("go2rtc WHEP failed (HTTP {}){}", status.as_u16(), reason(&body)));
    }
    String::from_utf8(body.to_vec()).map_err(|_| "go2rtc returned a non-text answer".into())
}

/// Relay route `/<token>/go2rtc/<stream>`: pipes go2rtc's `/api/ws?src=<stream>`
/// (MSE: JSON control + fMP4 binary frames) verbatim over loopback.
pub(crate) async fn serve_mse(client: ClientWs, stream: &str) {
    let ep = match tauri::async_runtime::spawn_blocking(endpoint).await {
        Ok(Ok(ep)) => ep,
        Ok(Err(e)) => return reject(client, CLOSE_NOT_CONFIGURED, &e).await,
        Err(_) => return reject(client, CLOSE_NOT_CONFIGURED, "Credential store unavailable").await,
    };
    let scheme = if ep.https { "wss" } else { "ws" };
    let url = format!("{scheme}://{}/api/ws?src={}", ep.authority, encode(stream));
    match timeout(TIMEOUT, connect_async(url)).await {
        Ok(Ok((upstream, _))) => pipe(client, upstream).await,
        Ok(Err(_)) => reject(client, CLOSE_UPSTREAM, "Could not open the go2rtc stream").await,
        Err(_) => reject(client, CLOSE_UPSTREAM, "go2rtc connection timed out").await,
    }
}

async fn send(ep: &Endpoint, method: Method, path: &str, body: Bytes, ctype: Option<&str>) -> Result<(StatusCode, Bytes), String> {
    let mut req = Request::builder().method(method).uri(path).header(HOST, &ep.authority);
    if let Some(ct) = ctype {
        req = req.header(CONTENT_TYPE, ct);
    }
    let req = req.body(Full::new(body)).map_err(|e| e.to_string())?;
    let fut = async {
        let tcp = TcpStream::connect((ep.host.as_str(), ep.port)).await.map_err(|_| "Could not reach go2rtc".to_string())?;
        if ep.https {
            let tls = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
            let tls = tokio_native_tls::TlsConnector::from(tls)
                .connect(&ep.host, tcp)
                .await
                .map_err(|_| "TLS handshake with go2rtc failed".to_string())?;
            exchange(TokioIo::new(tls), req).await
        } else {
            exchange(TokioIo::new(tcp), req).await
        }
    };
    timeout(TIMEOUT, fut).await.map_err(|_| "go2rtc request timed out".to_string())?
}

async fn exchange<I>(io: I, req: Request<Full<Bytes>>) -> Result<(StatusCode, Bytes), String>
where
    I: hyper::rt::Read + hyper::rt::Write + Unpin + Send + 'static,
{
    let (mut sender, conn) = hyper::client::conn::http1::handshake(io).await.map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn(async move {
        let _ = conn.await;
    });
    let resp = sender.send_request(req).await.map_err(|_| "go2rtc request failed".to_string())?;
    let status = resp.status();
    let body = Limited::new(resp.into_body(), MAX_BODY)
        .collect()
        .await
        .map_err(|_| "go2rtc response too large".to_string())?
        .to_bytes();
    Ok((status, body))
}

/// go2rtc's plain-text error, as `": <text>"`. Only short text without URLs is
/// surfaced, so a stream source (and its camera token) can never leak through.
fn reason(body: &[u8]) -> String {
    let text = String::from_utf8_lossy(body);
    let text = text.trim();
    if !text.is_empty() && text.len() <= 200 && !text.contains("://") {
        format!(": {text}")
    } else {
        String::new()
    }
}

/// RFC 3986 unreserved-only percent-encoding for query values.
fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// Fake go2rtc that has "forgotten" the stream: POST 404 → PUT 200 → POST 201.
    #[tokio::test]
    async fn whep_reregisters_a_stream_go2rtc_dropped() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let mut seen = Vec::new();
            for reply in ["404 Not Found", "200 OK", "201 Created"] {
                let (mut s, _) = listener.accept().await.unwrap();
                let mut buf = vec![0u8; 8192];
                let n = s.read(&mut buf).await.unwrap();
                let head = String::from_utf8_lossy(&buf[..n]).lines().next().unwrap_or_default().to_owned();
                seen.push(head);
                let body = if reply.starts_with("201") { "v=0\r\nanswer" } else { "" };
                let resp = format!("HTTP/1.1 {reply}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                s.write_all(resp.as_bytes()).await.unwrap();
            }
            seen
        });
        let ep = parse_endpoint(&format!("http://127.0.0.1:{port}")).unwrap();
        REGISTERED.lock().unwrap().insert("shcm_cam1_high".into(), "rtspx://10.0.0.1:7441/tok".into());

        let answer = whep(&ep, "shcm_cam1_high", "v=0\r\noffer".into()).await.unwrap();
        assert!(answer.contains("answer"));
        let seen = server.await.unwrap();
        assert!(seen[0].starts_with("POST /api/webrtc?src=shcm_cam1_high"));
        assert!(seen[1].starts_with("PUT /api/streams?name=shcm_cam1_high&src=rtspx%3A%2F%2F10.0.0.1"));
        assert!(seen[2].starts_with("POST /api/webrtc"));
    }

    #[test]
    fn go2rtc_must_be_on_the_local_network() {
        assert!(parse_endpoint("http://127.0.0.1:1984").is_some());
        assert!(parse_endpoint("http://192.168.1.10:1984/").is_some());
        assert!(parse_endpoint("http://homeassistant.local:1984").is_some());
        assert!(parse_endpoint("http://homeassistant:1984").is_some());
        assert!(parse_endpoint("http://[fd00::5]:1984").is_some());
        assert!(parse_endpoint("http://8.8.8.8:1984").is_none());
        assert!(parse_endpoint("https://go2rtc.example.com").is_none());
        assert!(parse_endpoint("http://user:pw@127.0.0.1:1984").is_none());
        assert!(parse_endpoint("http://127.0.0.1:1984/api").is_none());
    }

    #[test]
    fn encodes_sources_for_query_strings() {
        assert_eq!(encode("rtspx://10.0.0.1:7441/a?b"), "rtspx%3A%2F%2F10.0.0.1%3A7441%2Fa%3Fb");
        assert!(valid_stream_name("shcm_abc123_high"));
        assert!(!valid_stream_name("a&src=evil"));
    }
}
