//! Disk side of the screensaver: folder scanning, image type checks, and the
//! cache of downloaded cloud photos.

use std::path::{Path, PathBuf};

use crate::cloud_http::get;
use crate::cloud_photos::CloudItem;

const MAX_FILES: usize = 20_000;
const MAX_DEPTH: usize = 12;
const MAX_DOWNLOAD: usize = 40 * 1024 * 1024;
/// Oldest cached cloud photos are dropped beyond this.
const CACHE_LIMIT: u64 = 2 * 1024 * 1024 * 1024;

const TYPES: &[(&str, &str)] = &[
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("png", "image/png"),
    ("webp", "image/webp"),
    ("gif", "image/gif"),
    ("bmp", "image/bmp"),
    ("avif", "image/avif"),
];

pub fn mime(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    TYPES.iter().find(|(e, _)| *e == ext).map(|(_, m)| *m)
}

/// Content type from the bytes themselves; only formats the webview can show (no SVG, no HEIC).
pub fn sniff(b: &[u8]) -> Option<&'static str> {
    match b {
        [0xFF, 0xD8, 0xFF, ..] => Some("image/jpeg"),
        [0x89, b'P', b'N', b'G', ..] => Some("image/png"),
        [b'G', b'I', b'F', b'8', ..] => Some("image/gif"),
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => Some("image/webp"),
        [b'B', b'M', ..] => Some("image/bmp"),
        [_, _, _, _, b'f', b't', b'y', b'p', b'a', b'v', b'i', b'f' | b's', ..] => Some("image/avif"),
        _ => None,
    }
}

/// Symlinks and junctions are skipped (no loops); OneDrive placeholders count as files.
pub fn walk(dir: &Path, depth: usize, recursive: bool, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if out.len() >= MAX_FILES {
            return;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || name.starts_with('$') {
            continue;
        }
        let Ok(kind) = entry.file_type() else { continue };
        let path = entry.path();
        if kind.is_dir() {
            if recursive && depth < MAX_DEPTH {
                walk(&path, depth + 1, recursive, out);
            }
        } else if kind.is_file() && mime(&path).is_some() {
            out.push(path);
        }
    }
}

async fn download(url: &str, auth: Option<&str>) -> Option<(&'static str, Vec<u8>)> {
    let headers: Vec<(&str, &str)> = auth.map(|a| vec![("Authorization", a)]).unwrap_or_default();
    let r = get(url, &headers, MAX_DOWNLOAD).await.ok()?;
    if !(200..300).contains(&r.status) {
        return None;
    }
    let ctype = sniff(&r.body)?;
    Some((ctype, r.body.to_vec()))
}

/// Cached copy, else download (main URL, then fallback) and cache it. Blocking.
pub fn cached_or_fetch(file: &Path, item: &CloudItem) -> Result<(&'static str, Vec<u8>), ()> {
    if let Ok(bytes) = std::fs::read(file) {
        if let Some(ctype) = sniff(&bytes) {
            return Ok((ctype, bytes));
        }
    }
    let fetched = tauri::async_runtime::block_on(async {
        match download(&item.url, item.auth.as_deref()).await {
            Some(hit) => Some(hit),
            None => match &item.fallback {
                Some(f) => download(f, None).await,
                None => None,
            },
        }
    });
    let (ctype, body) = fetched.ok_or(())?;
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
        let _ = std::fs::write(file, &body);
    }
    Ok((ctype, body))
}

/// Keeps the cache under its size limit, dropping the least recently written files.
pub fn trim_cache(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<(std::time::SystemTime, u64, PathBuf)> = entries
        .flatten()
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            m.is_file().then(|| (m.modified().ok(), m.len(), e.path()))
        })
        .filter_map(|(t, l, p)| Some((t?, l, p)))
        .collect();
    let mut total: u64 = files.iter().map(|f| f.1).sum();
    files.sort_by_key(|f| f.0);
    for (_, len, path) in files {
        if total <= CACHE_LIMIT {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total -= len;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_images_have_a_type() {
        assert_eq!(mime(Path::new("x/IMG_1.JPG")), Some("image/jpeg"));
        assert_eq!(mime(Path::new("x/notes.txt")), None);
        assert_eq!(mime(Path::new("x/pic.svg")), None);
    }

    #[test]
    fn sniffs_raster_formats_only() {
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(sniff(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(sniff(b"\0\0\0\x18ftypheic"), None);
        assert_eq!(sniff(b"<svg xmlns="), None);
    }
}
