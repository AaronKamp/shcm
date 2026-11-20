//! `/<token>/ha` route: Home Assistant WebSocket API with the Long-Lived Access
//! Token attached by Rust. The relay performs HA's `auth_required → auth →
//! auth_ok` handshake itself, forwards only the final `auth_ok` / `auth_invalid`
//! frame to the webview, then pipes everything else verbatim. The token never
//! crosses into JS, and the upstream host comes from the credential store too,
//! so the webview can't point the token at an arbitrary server.

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::{http::Uri, Error as WsError, Message};
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

use crate::relay_server::{pipe, reject, ClientWs};
use crate::secrets::{get_secret, SecretKind};

type Upstream = WebSocketStream<MaybeTlsStream<TcpStream>>;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Must match `HA_RELAY_CLOSE` in src/providers/homeassistant/HomeAssistantConnection.ts.
const CLOSE_NOT_CONFIGURED: u16 = 4010;
const CLOSE_AUTH_REJECTED: u16 = 4011;
const CLOSE_UPSTREAM: u16 = 4012;
const CLOSE_KEYSTORE: u16 = 4013;

pub(crate) async fn serve(mut client: ClientWs) {
    let creds = tauri::async_runtime::spawn_blocking(|| {
        Ok::<_, String>((get_secret(SecretKind::HomeAssistantUrl)?, get_secret(SecretKind::HomeAssistantToken)?))
    })
    .await;
    let (url, token) = match creds {
        Ok(Ok((Some(url), Some(token)))) => (url, token),
        Ok(Ok(_)) => return reject(client, CLOSE_NOT_CONFIGURED, "Home Assistant URL or token not set").await,
        _ => return reject(client, CLOSE_KEYSTORE, "Credential store unavailable").await,
    };
    let Some(ws_url) = to_ws_url(&url) else {
        return reject(client, CLOSE_NOT_CONFIGURED, "Home Assistant URL is invalid").await;
    };

    let mut upstream = match timeout(CONNECT_TIMEOUT, connect_async(ws_url)).await {
        Ok(Ok((ws, _))) => ws,
        Ok(Err(WsError::Http(resp))) => {
            let reason = format!("Home Assistant refused the connection (HTTP {})", resp.status().as_u16());
            return reject(client, CLOSE_UPSTREAM, &reason).await;
        }
        Ok(Err(_)) => return reject(client, CLOSE_UPSTREAM, "Could not reach Home Assistant").await,
        Err(_) => return reject(client, CLOSE_UPSTREAM, "Home Assistant connection timed out").await,
    };

    let outcome = timeout(CONNECT_TIMEOUT, authenticate(&mut upstream, &token)).await;
    drop(token);
    match outcome {
        Ok(Ok(auth_ok)) => {
            if client.send(auth_ok).await.is_ok() {
                pipe(client, upstream).await;
            }
        }
        Ok(Err(AuthFailure::Rejected(frame))) => {
            let _ = upstream.close(None).await;
            // Forward HA's own auth_invalid (no secrets in it) so the UI shows its message.
            let _ = client.send(frame).await;
            reject(client, CLOSE_AUTH_REJECTED, "Home Assistant rejected the access token").await;
        }
        Ok(Err(AuthFailure::Protocol)) | Err(_) => {
            let _ = upstream.close(None).await;
            reject(client, CLOSE_UPSTREAM, "Home Assistant auth handshake failed").await;
        }
    }
}

enum AuthFailure {
    Rejected(Message),
    Protocol,
}

/// Runs the HA auth handshake; returns the upstream `auth_ok` frame untouched.
async fn authenticate(upstream: &mut Upstream, token: &str) -> Result<Message, AuthFailure> {
    let (first, _) = next_typed(upstream).await?;
    if first != "auth_required" {
        return Err(AuthFailure::Protocol);
    }
    let auth = json!({ "type": "auth", "access_token": token }).to_string();
    upstream.send(Message::text(auth)).await.map_err(|_| AuthFailure::Protocol)?;
    match next_typed(upstream).await? {
        (kind, frame) if kind == "auth_ok" => Ok(frame),
        (kind, frame) if kind == "auth_invalid" => Err(AuthFailure::Rejected(frame)),
        _ => Err(AuthFailure::Protocol),
    }
}

/// Next text frame's `type` plus the original frame (only handshake frames are parsed).
async fn next_typed(upstream: &mut Upstream) -> Result<(String, Message), AuthFailure> {
    while let Some(msg) = upstream.next().await {
        let msg = msg.map_err(|_| AuthFailure::Protocol)?;
        let Message::Text(text) = &msg else { continue };
        let kind = serde_json::from_str::<Value>(text.as_str())
            .ok()
            .and_then(|v| v.get("type").and_then(Value::as_str).map(str::to_owned))
            .ok_or(AuthFailure::Protocol)?;
        return Ok((kind, msg));
    }
    Err(AuthFailure::Protocol)
}

/// `http(s)://host:8123[/base]` or `ws(s)://…` → `ws(s)://host:8123[/base]/api/websocket`.
pub(crate) fn to_ws_url(raw: &str) -> Option<String> {
    let uri: Uri = raw.trim().parse().ok()?;
    let scheme = match uri.scheme_str()? {
        "http" | "ws" => "ws",
        "https" | "wss" => "wss",
        _ => return None,
    };
    let authority = uri.authority()?.as_str();
    if authority.contains('@') || uri.query().is_some() {
        return None;
    }
    let path = uri.path().trim_end_matches('/');
    let path = if path.ends_with("/api/websocket") { path.to_owned() } else { format!("{path}/api/websocket") };
    Some(format!("{scheme}://{authority}{path}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    /// Minimal fake HA: auth_required → expects our token → auth_ok / auth_invalid.
    async fn fake_ha(good_token: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let mut ws = tokio_tungstenite::accept_async(tcp).await.unwrap();
            ws.send(Message::text(r#"{"type":"auth_required","ha_version":"2026.11"}"#)).await.unwrap();
            let Some(Ok(Message::Text(auth))) = ws.next().await else { panic!("no auth frame") };
            let v: Value = serde_json::from_str(auth.as_str()).unwrap();
            let reply = if v["type"] == "auth" && v["access_token"] == good_token {
                r#"{"type":"auth_ok","ha_version":"2026.11"}"#
            } else {
                r#"{"type":"auth_invalid","message":"Invalid access token"}"#
            };
            ws.send(Message::text(reply)).await.unwrap();
        });
        format!("ws://{addr}/api/websocket")
    }

    #[tokio::test]
    async fn authenticates_with_stored_token_and_forwards_auth_ok() {
        let (mut up, _) = connect_async(fake_ha("tok-123").await).await.unwrap();
        let Ok(Message::Text(frame)) = authenticate(&mut up, "tok-123").await else { panic!("auth failed") };
        assert!(frame.as_str().contains("auth_ok"));
        assert!(!frame.as_str().contains("tok-123"), "token must never be in the frame sent to the webview");
    }

    #[tokio::test]
    async fn bad_token_surfaces_auth_invalid() {
        let (mut up, _) = connect_async(fake_ha("tok-123").await).await.unwrap();
        assert!(matches!(authenticate(&mut up, "wrong").await, Err(AuthFailure::Rejected(_))));
    }
}
