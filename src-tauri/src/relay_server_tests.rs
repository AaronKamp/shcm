use super::*;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

async fn status_for(url: &str, origin: Option<&str>) -> Option<u16> {
    let mut req = url.into_client_request().unwrap();
    if let Some(o) = origin {
        req.headers_mut().insert(ORIGIN, o.parse().unwrap());
    }
    match connect_async(req).await {
        Ok(_) => None,
        Err(WsError::Http(resp)) => Some(resp.status().as_u16()),
        Err(e) => panic!("unexpected error: {e}"),
    }
}

#[tokio::test]
async fn rejects_wrong_token_unknown_route_and_foreign_origin() {
    let base = bind_and_serve().unwrap();
    let (root, _token) = base.rsplit_once('/').unwrap();
    assert_eq!(status_for(&format!("{root}/nope/gemini"), None).await, Some(403));
    assert_eq!(status_for(&format!("{base}/unknown"), None).await, Some(403));
    assert_eq!(status_for(&base, None).await, Some(403));
    assert_eq!(status_for(&format!("{base}/ha"), Some("https://evil.example")).await, Some(403));
    assert_eq!(status_for(&format!("{base}/gemini"), Some("tauri://localhost")).await, None);
    assert_eq!(status_for(&format!("{base}/ha"), Some("http://tauri.localhost")).await, None);
}

#[test]
fn parses_routes_with_exact_token() {
    let t = "ab".repeat(32);
    assert_eq!(parse_route(&format!("/{t}/gemini"), &t), Some(Route::Gemini));
    assert_eq!(parse_route(&format!("/{t}/ha"), &t), Some(Route::HomeAssistant));
    assert_eq!(parse_route(&format!("/{t}x/ha"), &t), None);
    assert_eq!(parse_route(&format!("/{t}/ha/extra"), &t), None);
    assert_eq!(parse_route(&format!("/{t}/go2rtc/shcm_abc_high"), &t), Some(Route::Go2rtc("shcm_abc_high".into())));
    assert_eq!(parse_route(&format!("/{t}/go2rtc/"), &t), None);
    assert_eq!(parse_route(&format!("/{t}/go2rtc/a/b"), &t), None);
    assert_eq!(parse_route(&format!("/{t}/go2rtc/a%20b"), &t), None);
}

#[test]
fn token_is_256_bit_hex() {
    let t = random_token().unwrap();
    assert_eq!(t.len(), 64);
    assert!(t.bytes().all(|b| b.is_ascii_hexdigit()));
    assert_ne!(t, random_token().unwrap());
}

#[test]
fn home_assistant_urls_normalize_to_websocket_endpoint() {
    use crate::ha_relay::to_ws_url;
    assert_eq!(to_ws_url("http://homeassistant.local:8123").as_deref(), Some("ws://homeassistant.local:8123/api/websocket"));
    assert_eq!(to_ws_url("https://ha.example.com/").as_deref(), Some("wss://ha.example.com/api/websocket"));
    assert_eq!(to_ws_url("wss://ha.example.com/api/websocket").as_deref(), Some("wss://ha.example.com/api/websocket"));
    assert_eq!(to_ws_url("ftp://ha"), None);
    assert_eq!(to_ws_url("http://user:pw@ha:8123"), None);
}
