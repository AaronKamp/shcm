//! Screensaver photos from local/cloud-synced folders and public cloud share
//! links. `photo_list` scans folders and resolves links, remembering the
//! result; the `shcmphoto` URI scheme then serves only those photos, so the
//! webview can't use it to read anything else. Cloud photos get opaque keys
//! (`cloud/<hash>`): share tokens and signed URLs never reach the webview.
//! They're cached on disk so a slideshow doesn't re-download every cycle.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime};

use crate::cloud_photos::{self, CloudItem, Service};
use crate::photo_files::{cached_or_fetch, mime, trim_cache, walk};

/// Must match `PHOTO_SCHEME` in src/platform/photos.ts.
pub const SCHEME: &str = "shcmphoto";
const CLOUD_PREFIX: &str = "cloud/";
/// Panorama-sized JPEGs are fine; anything bigger is probably not a photo.
const MAX_IMAGE: u64 = 60 * 1024 * 1024;

#[derive(Clone)]
pub(crate) struct CloudEntry {
    pub link: String,
    pub item: CloudItem,
}

/// What the last `photo_list` found; the only photos the scheme serves.
#[derive(Default)]
pub struct PhotoIndex {
    locals: Mutex<HashSet<PathBuf>>,
    cloud: Mutex<HashMap<String, CloudEntry>>,
}

fn cloud_key(link: &str, id: &str) -> String {
    let digest = Sha256::digest(format!("{link}\n{id}").as_bytes());
    let hex: String = digest.iter().take(16).map(|b| format!("{b:02x}")).collect();
    format!("{CLOUD_PREFIX}{hex}")
}

/// Must match `LinkStatus` in src/platform/photos.ts.
#[derive(Serialize)]
pub struct LinkStatus {
    link: String,
    service: Option<Service>,
    count: usize,
    error: Option<String>,
}

/// Must match `PhotoList` in src/platform/photos.ts.
#[derive(Serialize)]
pub struct PhotoList {
    /// Local paths and `cloud/<hash>` keys, for `convertFileSrc(key, 'shcmphoto')`.
    photos: Vec<String>,
    links: Vec<LinkStatus>,
}

#[tauri::command]
pub async fn photo_list<R: Runtime>(app: AppHandle<R>, folders: Vec<String>, recursive: bool, links: Vec<String>) -> Result<PhotoList, String> {
    let scan = tauri::async_runtime::spawn_blocking(move || {
        let mut out = Vec::new();
        for folder in &folders {
            walk(Path::new(folder), 0, recursive, &mut out);
        }
        out.sort();
        out.dedup();
        out
    });
    let resolved = futures_util::future::join_all(links.iter().map(|l| cloud_photos::list(l))).await;
    let files = scan.await.map_err(|e| e.to_string())?;

    let mut photos: Vec<String> = files.iter().map(|p| p.to_string_lossy().into_owned()).collect();
    let mut cloud = HashMap::new();
    let mut statuses = Vec::new();
    for (link, result) in links.into_iter().zip(resolved) {
        let service = cloud_photos::detect(&link);
        match result {
            Ok(items) => {
                statuses.push(LinkStatus { link: link.clone(), service, count: items.len(), error: None });
                for item in items {
                    let key = cloud_key(&link, &item.id);
                    photos.push(key.clone());
                    cloud.insert(key, CloudEntry { link: link.clone(), item });
                }
            }
            Err(e) => statuses.push(LinkStatus { link, service, count: 0, error: Some(e) }),
        }
    }
    let index = app.state::<PhotoIndex>();
    if let Ok(mut l) = index.locals.lock() {
        *l = files.into_iter().collect();
    }
    if let Ok(mut c) = index.cloud.lock() {
        *c = cloud;
    }
    if let Ok(dir) = cache_dir(&app) {
        tauri::async_runtime::spawn_blocking(move || trim_cache(&dir));
    }
    Ok(PhotoList { photos, links: statuses })
}

/// Must match `SuggestedFolder` in src/platform/photos.ts.
#[derive(Serialize)]
pub struct SuggestedFolder {
    label: String,
    path: String,
}

/// Well-known photo folders on this PC, including cloud sync folders, that exist.
#[tauri::command]
pub fn photo_suggested_folders() -> Vec<SuggestedFolder> {
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
    let mut candidates: Vec<(&str, PathBuf)> = Vec::new();
    if let Some(h) = &home {
        candidates.push(("Pictures", h.join("Pictures")));
        candidates.push(("Amazon Photos", h.join("Pictures").join("Amazon Photos Downloads")));
        candidates.push(("Amazon Photos", h.join("Amazon Photos")));
        candidates.push(("iCloud Photos", h.join("Pictures").join("iCloud Photos").join("Photos")));
        candidates.push(("Dropbox", h.join("Dropbox").join("Photos")));
        candidates.push(("Dropbox Camera Uploads", h.join("Dropbox").join("Camera Uploads")));
    }
    for var in ["OneDrive", "OneDriveConsumer"] {
        if let Some(od) = std::env::var_os(var) {
            candidates.push(("OneDrive Pictures", PathBuf::from(od).join("Pictures")));
        }
    }
    candidates.push(("Google Drive", PathBuf::from(r"G:\My Drive")));
    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|(_, p)| p.is_dir() && seen.insert(p.clone()))
        .map(|(label, p)| SuggestedFolder { label: label.into(), path: p.to_string_lossy().into_owned() })
        .collect()
}

fn cache_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path().app_cache_dir().map(|d| d.join("photo-cache")).map_err(|e| e.to_string())
}

fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn status(code: StatusCode) -> Response<Vec<u8>> {
    let mut r = Response::new(Vec::new());
    *r.status_mut() = code;
    r
}

fn image(ctype: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .header(header::CONTENT_TYPE, ctype)
        // The slideshow samples pixels to pick overlay contrast, which needs CORS.
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "max-age=3600")
        .body(body)
        .unwrap_or_else(|_| status(StatusCode::INTERNAL_SERVER_ERROR))
}

/// Re-resolves a share link (signed URLs expire) and returns the same photo's fresh entry.
fn relist<R: Runtime>(app: &AppHandle<R>, key: &str, entry: &CloudEntry) -> Option<CloudEntry> {
    let items = tauri::async_runtime::block_on(cloud_photos::list(&entry.link)).ok()?;
    let index = app.state::<PhotoIndex>();
    let mut cloud = index.cloud.lock().ok()?;
    for item in items {
        let k = cloud_key(&entry.link, &item.id);
        if let Some(e) = cloud.get_mut(&k) {
            e.item = item;
        }
    }
    cloud.get(key).cloned()
}

/// `convertFileSrc(path, 'shcmphoto')` puts the URL-encoded path or key in the URL path.
/// Runs on a blocking thread (see desktop.rs), so network fetches block here.
pub fn serve<R: Runtime>(app: &AppHandle<R>, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let Some(key) = percent_decode(request.uri().path().trim_start_matches('/')) else {
        return status(StatusCode::BAD_REQUEST);
    };
    let index = app.state::<PhotoIndex>();
    if key.starts_with(CLOUD_PREFIX) {
        let Some(entry) = index.cloud.lock().ok().and_then(|c| c.get(&key).cloned()) else {
            return status(StatusCode::NOT_FOUND);
        };
        let Ok(dir) = cache_dir(app) else { return status(StatusCode::INTERNAL_SERVER_ERROR) };
        let file = dir.join(&key[CLOUD_PREFIX.len()..]);
        return match cached_or_fetch(&file, &entry.item).or_else(|_| relist(app, &key, &entry).ok_or(()).and_then(|e| cached_or_fetch(&file, &e.item))) {
            Ok((ctype, body)) => image(ctype, body),
            Err(()) => status(StatusCode::BAD_GATEWAY),
        };
    }
    let path = PathBuf::from(&key);
    let allowed = index.locals.lock().map(|i| i.contains(&path)).unwrap_or(false);
    let (true, Some(ctype)) = (allowed, mime(&path)) else {
        return status(StatusCode::NOT_FOUND);
    };
    match std::fs::metadata(&path) {
        Ok(m) if m.len() <= MAX_IMAGE => {}
        Ok(_) => return status(StatusCode::PAYLOAD_TOO_LARGE),
        Err(_) => return status(StatusCode::NOT_FOUND),
    }
    match std::fs::read(&path) {
        Ok(body) => image(ctype, body),
        Err(_) => status(StatusCode::NOT_FOUND),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_windows_paths() {
        assert_eq!(percent_decode("C%3A%5CPics%5Ca%20b.jpg").as_deref(), Some(r"C:\Pics\a b.jpg"));
        assert!(percent_decode("bad%2").is_none());
    }

    #[test]
    fn cloud_keys_are_opaque_and_stable() {
        let a = cloud_key("https://1drv.ms/f/secret", "item1");
        assert_eq!(a, cloud_key("https://1drv.ms/f/secret", "item1"));
        assert!(a.starts_with("cloud/") && !a.contains("secret") && a.len() == 6 + 32);
    }
}
