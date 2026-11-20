//! Minimal HTTPS client for public cloud share links (hyper + native TLS,
//! same stack as the rest of the app). Follows redirects, caps body size, and
//! sends a generic browser User-Agent so share pages render normally.

use std::time::Duration;

use bytes::Bytes;
use http_body_util::{BodyExt, Full, Limited};
use hyper::header::{HOST, LOCATION, USER_AGENT};
use hyper::{Method, Request, Uri};
use hyper_util::rt::TokioIo;
use tokio::net::TcpStream;
use tokio::time::timeout;

const TIMEOUT: Duration = Duration::from_secs(25);
const MAX_REDIRECTS: usize = 8;
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

pub struct HttpResponse {
    pub status: u16,
    pub body: Bytes,
    /// URL after redirects.
    pub final_url: String,
}

fn join(base: &Uri, location: &str) -> Option<String> {
    if location.starts_with("https://") || location.starts_with("http://") {
        return Some(location.to_owned());
    }
    let origin = format!("{}://{}", base.scheme_str()?, base.authority()?);
    if location.starts_with('/') {
        Some(format!("{origin}{location}"))
    } else {
        let path = base.path();
        let dir = &path[..path.rfind('/').map_or(0, |i| i + 1)];
        Some(format!("{origin}{dir}{location}"))
    }
}

/// One request. `max_body` 0 = don't read the body (used to resolve short links).
pub async fn request(method: Method, url: &str, headers: &[(&str, &str)], body: Option<String>, max_body: usize) -> Result<HttpResponse, String> {
    let mut url = url.to_owned();
    let mut method = method;
    let mut body = body;
    for _ in 0..=MAX_REDIRECTS {
        let uri: Uri = url.parse().map_err(|_| "Invalid link".to_string())?;
        let resp = timeout(TIMEOUT, send(&uri, method.clone(), headers, body.clone(), max_body))
            .await
            .map_err(|_| "Request timed out".to_string())??;
        if (300..400).contains(&resp.0) {
            if let Some(next) = resp.1.as_deref().and_then(|l| join(&uri, l)) {
                if resp.0 == 303 || ((resp.0 == 301 || resp.0 == 302) && method == Method::POST) {
                    method = Method::GET;
                    body = None;
                }
                url = next;
                continue;
            }
        }
        return Ok(HttpResponse { status: resp.0, body: resp.2, final_url: url });
    }
    Err("Too many redirects".into())
}

pub async fn get(url: &str, headers: &[(&str, &str)], max_body: usize) -> Result<HttpResponse, String> {
    request(Method::GET, url, headers, None, max_body).await
}

/// GET that must succeed with JSON.
pub async fn get_json(url: &str, headers: &[(&str, &str)]) -> Result<serde_json::Value, String> {
    let r = get(url, headers, 16 * 1024 * 1024).await?;
    if !(200..300).contains(&r.status) {
        return Err(format!("HTTP {}", r.status));
    }
    serde_json::from_slice(&r.body).map_err(|_| "Unexpected response".to_string())
}

type Raw = (u16, Option<String>, Bytes);

async fn send(uri: &Uri, method: Method, headers: &[(&str, &str)], body: Option<String>, max_body: usize) -> Result<Raw, String> {
    if uri.scheme_str() != Some("https") {
        return Err("Only https links are supported".into());
    }
    let host = uri.host().ok_or("Invalid link")?.trim_start_matches('[').trim_end_matches(']').to_owned();
    let port = uri.port_u16().unwrap_or(443);
    let path = uri.path_and_query().map_or("/", |p| p.as_str());
    let mut req = Request::builder()
        .method(method)
        .uri(path)
        .header(HOST, uri.authority().map_or(host.as_str(), |a| a.as_str()))
        .header(USER_AGENT, UA);
    for (k, v) in headers {
        req = req.header(*k, *v);
    }
    let req = req.body(Full::new(Bytes::from(body.unwrap_or_default()))).map_err(|_| "Invalid request".to_string())?;

    let tcp = TcpStream::connect((host.as_str(), port)).await.map_err(|_| format!("Could not reach {host}"))?;
    let tls = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
    let tls = tokio_native_tls::TlsConnector::from(tls)
        .connect(&host, tcp)
        .await
        .map_err(|_| format!("TLS handshake with {host} failed"))?;
    let (mut sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(tls)).await.map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn(async move {
        let _ = conn.await;
    });
    let resp = sender.send_request(req).await.map_err(|_| format!("Request to {host} failed"))?;
    let status = resp.status().as_u16();
    let location = resp.headers().get(LOCATION).and_then(|v| v.to_str().ok()).map(str::to_owned);
    if max_body == 0 || (300..400).contains(&status) {
        return Ok((status, location, Bytes::new()));
    }
    let body = Limited::new(resp.into_body(), max_body).collect().await.map_err(|_| "Response too large".to_string())?.to_bytes();
    Ok((status, location, body))
}

/// RFC 4648 §5 base64url without padding (OneDrive `u!` share ids).
pub fn base64url(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for i in 0..=chunk.len() {
            out.push(TABLE[((n >> (18 - 6 * i)) & 63) as usize] as char);
        }
    }
    out
}

/// Value of one query parameter (percent-decoding `%XX` and `+`).
pub fn query_param(url: &str, name: &str) -> Option<String> {
    let query = url.split_once('?')?.1.split('#').next()?;
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        (k == name).then(|| percent_decode(&v.replace('+', " ")))
    })
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            if let Some(v) = b.get(i + 1..i + 3).and_then(|h| std::str::from_utf8(h).ok()).and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64url_has_no_padding() {
        assert_eq!(base64url(b"f"), "Zg");
        assert_eq!(base64url(b"fo"), "Zm8");
        assert_eq!(base64url(b"\xfb\xff"), "-_8");
    }

    #[test]
    fn reads_query_params() {
        assert_eq!(query_param("https://x/?a=1&redeem=aHR0c%3D&b", "redeem").as_deref(), Some("aHR0c="));
        assert_eq!(query_param("https://x/", "redeem"), None);
    }

    #[test]
    fn joins_relative_redirects() {
        let base: Uri = "https://a.example/x/y?z".parse().unwrap();
        assert_eq!(join(&base, "/p").as_deref(), Some("https://a.example/p"));
        assert_eq!(join(&base, "q").as_deref(), Some("https://a.example/x/q"));
        assert_eq!(join(&base, "https://b.example/").as_deref(), Some("https://b.example/"));
    }
}
