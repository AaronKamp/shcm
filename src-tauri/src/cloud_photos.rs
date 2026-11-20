//! Photos from public share links, with no sync app or sign-in:
//! - Google Photos shared albums: image URLs embedded in the album page.
//! - Amazon Photos shared albums/folders: the JSON endpoints the share page uses.
//! - OneDrive "anyone with the link" folders: the anonymous (Badger) token flow
//!   OneDrive's own web viewer uses.
//! None of these are official APIs; errors say so plainly so a broken link
//! can be told apart from a service change.

use std::collections::{HashSet, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use hyper::Method;
use serde::Serialize;
use serde_json::Value;

use crate::cloud_http::{base64url, get, get_json, query_param, request};

const MAX_ITEMS: usize = 5_000;
const MAX_FOLDERS: usize = 100;
const MAX_DEPTH: usize = 3;
/// Longest edge requested from services that resize server-side.
const EDGE: u32 = 2560;

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Service {
    GooglePhotos,
    AmazonPhotos,
    OneDrive,
}

/// One remote photo. `auth` is an Authorization header value when the URL needs one.
#[derive(Clone)]
pub struct CloudItem {
    pub id: String,
    pub url: String,
    pub auth: Option<String>,
    /// Tried when `url` fails (OneDrive: the original file if no thumbnail).
    pub fallback: Option<String>,
}

fn host_of(link: &str) -> Option<String> {
    let rest = link.trim().strip_prefix("https://")?;
    Some(rest.split(['/', '?', '#']).next()?.to_ascii_lowercase())
}

pub fn detect(link: &str) -> Option<Service> {
    let host = host_of(link)?;
    let host = host.trim_start_matches("www.");
    if host == "photos.app.goo.gl" || (host == "photos.google.com" && link.contains("/share/")) || (host == "goo.gl" && link.contains("/photos/")) {
        Some(Service::GooglePhotos)
    } else if host.starts_with("amazon.") && (link.contains("/photos/share/") || link.contains("/clouddrive/share/")) {
        Some(Service::AmazonPhotos)
    } else if host == "1drv.ms" || host == "onedrive.live.com" || host == "onedrive.com" || host == "photos.onedrive.com" {
        Some(Service::OneDrive)
    } else {
        None
    }
}

pub async fn list(link: &str) -> Result<Vec<CloudItem>, String> {
    match detect(link) {
        Some(Service::GooglePhotos) => google_photos(link.trim()).await,
        Some(Service::AmazonPhotos) => amazon(link.trim()).await,
        Some(Service::OneDrive) => onedrive(link.trim()).await,
        None => Err("Not a Google Photos, Amazon Photos or OneDrive share link".into()),
    }
}

// ---- Google Photos ---------------------------------------------------------

const LH3: &str = "https://lh3.googleusercontent.com/pw/";

async fn google_photos(link: &str) -> Result<Vec<CloudItem>, String> {
    let page = get(link, &[("Accept-Language", "en-US,en;q=0.8")], 12 * 1024 * 1024).await?;
    if page.status != 200 {
        return Err(format!("Google Photos returned HTTP {} — is the album still shared by link?", page.status));
    }
    let html = String::from_utf8_lossy(&page.body);
    let mut seen = HashSet::new();
    let mut items = Vec::new();
    for (at, _) in html.match_indices(LH3) {
        let id: String = html[at + LH3.len()..].chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
        if id.len() >= 20 && seen.insert(id.clone()) {
            items.push(CloudItem { url: format!("{LH3}{id}=w{EDGE}-h{EDGE}"), id, auth: None, fallback: None });
        }
        if items.len() >= MAX_ITEMS {
            break;
        }
    }
    if items.is_empty() {
        return Err("No photos found on the album page (Google may have changed the page)".into());
    }
    Ok(items)
}

// ---- Amazon Photos ---------------------------------------------------------

fn amazon_share(link: &str) -> Option<(String, String)> {
    let host = host_of(link)?;
    let path = link.trim().strip_prefix("https://")?.split_once('/')?.1;
    let after = path.split_once("/share/")?.1;
    let id: String = after.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
    (id.len() >= 10).then(|| (format!("https://www.{}", host.trim_start_matches("www.")), id))
}

async fn amazon(link: &str) -> Result<Vec<CloudItem>, String> {
    let (origin, sid) = amazon_share(link).ok_or("Unrecognized Amazon Photos link")?;
    let common = format!("shareId={sid}&resourceVersion=V2&ContentType=JSON");
    let accept = [("Accept", "application/json")];
    let share = get_json(&format!("{origin}/drive/v1/shares/{sid}?{common}"), &accept)
        .await
        .map_err(|e| format!("Amazon Photos: {e} — is the album still shared by link?"))?;
    let root = share["nodeInfo"]["id"].as_str().ok_or("Amazon Photos changed its share format")?.to_owned();
    let mut queue = VecDeque::from([(root, 0usize)]);
    let mut items = Vec::new();
    let mut folders = 0;
    while let Some((folder, depth)) = queue.pop_front() {
        folders += 1;
        let mut offset = 0u64;
        loop {
            let url = format!("{origin}/drive/v1/nodes/{folder}/children?asset=ALL&limit=200&offset={offset}&searchOnFamily=false&tempLink=true&{common}");
            let page = get_json(&url, &accept).await.map_err(|e| format!("Amazon Photos: {e}"))?;
            let data = page["data"].as_array().cloned().unwrap_or_default();
            if data.is_empty() {
                break;
            }
            offset += data.len() as u64;
            for n in &data {
                let id = n["id"].as_str().unwrap_or_default();
                match n["kind"].as_str() {
                    Some("FOLDER") if depth < MAX_DEPTH && folders + queue.len() < MAX_FOLDERS => queue.push_back((id.to_owned(), depth + 1)),
                    Some("FILE") => {
                        let image = n["contentProperties"]["contentType"].as_str().is_some_and(|t| t.starts_with("image/"));
                        if let (true, Some(link)) = (image, n["tempLink"].as_str()) {
                            let sep = if link.contains('?') { '&' } else { '?' };
                            items.push(CloudItem { id: id.to_owned(), url: format!("{link}{sep}viewBox={EDGE},{EDGE}"), auth: None, fallback: None });
                        }
                    }
                    _ => {}
                }
            }
            if items.len() >= MAX_ITEMS || page["count"].as_u64().is_some_and(|c| offset >= c) {
                break;
            }
        }
        if items.len() >= MAX_ITEMS {
            break;
        }
    }
    Ok(items)
}

// ---- OneDrive --------------------------------------------------------------

const ONEDRIVE_API: &str = "https://my.microsoftpersonalcontent.com/_api/v2.0";
const BADGER_URL: &str = "https://api-badgerp.svc.ms/v1.0/token";
/// OneDrive web viewer's public app ids for anonymous share access.
const BADGER_APP_ID: &str = "1141147648";
const BADGER_APP_UUID: &str = "5cbed6ac-a083-4e14-b191-b4ba07653de2";
const TOKEN_TTL: Duration = Duration::from_secs(12 * 3600);

static BADGER: Mutex<Option<(String, Instant)>> = Mutex::new(None);

async fn badger_token() -> Result<String, String> {
    if let Some((t, at)) = BADGER.lock().ok().and_then(|g| g.clone()) {
        if at.elapsed() < TOKEN_TTL {
            return Ok(t);
        }
    }
    let body = format!(r#"{{"appId":"{BADGER_APP_UUID}"}}"#);
    let r = request(Method::POST, BADGER_URL, &[("Content-Type", "application/json"), ("AppId", BADGER_APP_ID)], Some(body), 64 * 1024).await?;
    let v: Value = serde_json::from_slice(&r.body).map_err(|_| "OneDrive sign-in service changed".to_string())?;
    let token = v["token"].as_str().ok_or("OneDrive didn't issue an anonymous token")?.to_owned();
    if let Ok(mut g) = BADGER.lock() {
        *g = Some((token.clone(), Instant::now()));
    }
    Ok(token)
}

/// Only base64url characters pass unescaped.
fn escape_share_id(s: &str) -> String {
    s.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

fn is_image(item: &Value) -> bool {
    item["image"].is_object() || item["file"]["mimeType"].as_str().is_some_and(|m| m.starts_with("image/"))
}

async fn onedrive(link: &str) -> Result<Vec<CloudItem>, String> {
    // Short links redirect to a URL carrying `redeem`; otherwise the link itself is the share id.
    let resolved = get(link, &[], 0).await.map(|r| r.final_url).unwrap_or_else(|_| link.to_owned());
    let redeem = query_param(&resolved, "redeem").unwrap_or_else(|| base64url(link.as_bytes()));
    let auth = format!("Badger {}", badger_token().await?);
    let headers = [("Authorization", auth.as_str()), ("Prefer", "autoredeem"), ("Accept", "application/json")];
    let root = get_json(&format!("{ONEDRIVE_API}/shares/u!{}/driveitem?$expand=children", escape_share_id(&redeem)), &headers)
        .await
        .map_err(|e| format!("OneDrive: {e} — is the folder shared with \"Anyone with the link\"?"))?;

    let mut items = Vec::new();
    let add = |it: &Value, items: &mut Vec<CloudItem>| {
        let (Some(id), Some(drive)) = (it["id"].as_str(), it["parentReference"]["driveId"].as_str()) else { return };
        if is_image(it) {
            items.push(CloudItem {
                id: id.to_owned(),
                url: format!("{ONEDRIVE_API}/drives/{drive}/items/{id}/thumbnails/0/c{EDGE}x{EDGE}/content"),
                auth: Some(auth.clone()),
                fallback: it["@content.downloadUrl"].as_str().map(str::to_owned),
            });
        }
    };
    if !root["folder"].is_object() {
        add(&root, &mut items);
        return Ok(items);
    }

    // (first page of children, next-page link, depth)
    let mut queue: VecDeque<(Vec<Value>, Option<String>, usize)> = VecDeque::new();
    queue.push_back((root["children"].as_array().cloned().unwrap_or_default(), root["children@odata.nextLink"].as_str().map(str::to_owned), 0));
    let mut folders = 1;
    while let Some((mut page, mut next, depth)) = queue.pop_front() {
        loop {
            for it in &page {
                if it["folder"].is_object() {
                    if depth < MAX_DEPTH && folders < MAX_FOLDERS {
                        if let (Some(id), Some(drive)) = (it["id"].as_str(), it["parentReference"]["driveId"].as_str()) {
                            folders += 1;
                            let url = format!("{ONEDRIVE_API}/drives/{drive}/items/{id}/children");
                            queue.push_back((Vec::new(), Some(url), depth + 1));
                        }
                    }
                } else {
                    add(it, &mut items);
                }
            }
            if items.len() >= MAX_ITEMS {
                return Ok(items);
            }
            let Some(url) = next.take() else { break };
            let v = get_json(&url, &headers).await.map_err(|e| format!("OneDrive: {e}"))?;
            page = v["value"].as_array().cloned().unwrap_or_default();
            next = v["@odata.nextLink"].as_str().map(str::to_owned);
        }
    }
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_services() {
        assert!(detect("https://photos.app.goo.gl/AbCdEf123") == Some(Service::GooglePhotos));
        assert!(detect("https://photos.google.com/share/AF1Qxyz?key=abc") == Some(Service::GooglePhotos));
        assert!(detect("https://www.amazon.com/photos/share/AbCdEfGhIjKlMn") == Some(Service::AmazonPhotos));
        assert!(detect("https://1drv.ms/f/c/abc/EgXyz") == Some(Service::OneDrive));
        assert!(detect("http://1drv.ms/f/x").is_none());
        assert!(detect("https://example.com/photos/share/x").is_none());
    }

    #[test]
    fn parses_amazon_share() {
        let (origin, id) = amazon_share("https://amazon.co.uk/photos/share/AbCdEfGhIjKlMnOp?x=1").unwrap();
        assert_eq!((origin.as_str(), id.as_str()), ("https://www.amazon.co.uk", "AbCdEfGhIjKlMnOp"));
    }

    #[test]
    fn escapes_share_ids() {
        assert_eq!(escape_share_id("aHR0c-_x="), "aHR0c-_x%3D");
    }
}
