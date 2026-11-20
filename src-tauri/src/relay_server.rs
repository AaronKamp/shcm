//! Loopback WebSocket relay that keeps credentials out of the webview. The
//! frontend opens `ws://127.0.0.1:<port>/<token>/<route>`; route handlers pull
//! credentials from the OS store and attach them upstream (see
//! `gemini_proxy.rs`, `ha_relay.rs`). Data frames are piped verbatim; audio
//! never crosses Tauri's invoke/emit IPC bridge.
//!
//! Access control: loopback-only bind, an unguessable per-launch path token
//! (handed out only via Tauri commands), and an Origin allowlist so a web page in
//! the user's browser can't drive the relay even if it finds the port.

use std::net::Ipv4Addr;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{Sink, SinkExt, Stream, StreamExt};
use tauri::{AppHandle, Manager, Runtime, State};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::{header::ORIGIN, StatusCode};
use tokio_tungstenite::tungstenite::protocol::{frame::coding::CloseCode, CloseFrame};
use tokio_tungstenite::tungstenite::{Error as WsError, Message};
use tokio_tungstenite::{accept_hdr_async, WebSocketStream};

pub type ClientWs = WebSocketStream<TcpStream>;

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);

/// Webview origins: Windows/Android use http(s)://tauri.localhost, macOS/Linux tauri://localhost.
const ALLOWED_ORIGINS: &[&str] = &["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"];
/// Vite dev server (`build.devUrl`), accepted in debug builds only.
#[cfg(debug_assertions)]
const DEV_ORIGINS: &[&str] = &["http://localhost:5173", "http://127.0.0.1:5173"];
#[cfg(not(debug_assertions))]
const DEV_ORIGINS: &[&str] = &[];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Route {
    Gemini,
    HomeAssistant,
    /// go2rtc MSE (fMP4 over WebSocket) for one registered stream; used for H.265
    /// cameras, which the webview can decode via MSE but not via WebRTC.
    Go2rtc(String),
}

/// Managed state: `ws://127.0.0.1:<port>/<token>`, or why the relay couldn't start.
pub struct RelayServer {
    base: Result<String, String>,
}

impl RelayServer {
    fn url(&self, segment: &str) -> Result<String, String> {
        self.base.as_ref().map(|b| format!("{b}/{segment}")).map_err(Clone::clone)
    }
}

/// Binds synchronously (so URLs exist before any window asks) and serves in the background.
pub fn start<R: Runtime>(app: &AppHandle<R>) {
    let base = bind_and_serve().map_err(|e| {
        eprintln!("[shcm] local relay failed to start: {e}");
        format!("Local relay unavailable: {e}")
    });
    app.manage(RelayServer { base });
}

#[tauri::command]
pub fn get_gemini_proxy_url(relay: State<'_, RelayServer>) -> Result<String, String> {
    relay.url("gemini")
}

#[tauri::command]
pub fn get_home_assistant_relay_url(relay: State<'_, RelayServer>) -> Result<String, String> {
    relay.url("ha")
}

/// `ws://127.0.0.1:<port>/<token>/go2rtc/<stream>`: go2rtc's MSE WebSocket for a
/// stream, relayed so the webview never needs go2rtc's address or CORS/Origin access.
#[tauri::command]
pub fn get_go2rtc_mse_url(relay: State<'_, RelayServer>, stream: String) -> Result<String, String> {
    if !crate::go2rtc::valid_stream_name(&stream) {
        return Err("Invalid stream name".into());
    }
    relay.url(&format!("go2rtc/{stream}"))
}

pub(crate) fn bind_and_serve() -> std::io::Result<String> {
    let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    listener.set_nonblocking(true)?;
    let port = listener.local_addr()?.port();
    let token: Arc<str> = random_token()?.into();
    let base = format!("ws://127.0.0.1:{port}/{token}");

    tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::from_std(listener) {
            Ok(l) => l,
            Err(e) => return eprintln!("[shcm] relay listener error: {e}"),
        };
        loop {
            match listener.accept().await {
                Ok((stream, peer)) if peer.ip().is_loopback() => {
                    let _ = stream.set_nodelay(true);
                    tauri::async_runtime::spawn(handle(stream, Arc::clone(&token)));
                }
                Ok(_) => {}
                Err(e) => {
                    // e.g. fd exhaustion: back off instead of spinning.
                    eprintln!("[shcm] relay accept error: {e}");
                    tokio::time::sleep(Duration::from_millis(250)).await;
                }
            }
        }
    });
    Ok(base)
}

async fn handle(stream: TcpStream, token: Arc<str>) {
    let mut route = None;
    let check = |req: &Request, resp: Response| -> Result<Response, ErrorResponse> {
        route = parse_route(req.uri().path(), &token);
        // Browsers always send Origin; a missing one is a native client that still needs the token.
        let origin_ok = req.headers().get(ORIGIN).is_none_or(|o| o.to_str().is_ok_and(origin_allowed));
        if route.is_some() && origin_ok {
            Ok(resp)
        } else {
            let mut deny = ErrorResponse::new(Some("forbidden".into()));
            *deny.status_mut() = StatusCode::FORBIDDEN;
            Err(deny)
        }
    };
    let client = match timeout(HANDSHAKE_TIMEOUT, accept_hdr_async(stream, check)).await {
        Ok(Ok(ws)) => ws,
        _ => return,
    };
    match route {
        Some(Route::Gemini) => crate::gemini_proxy::serve(client).await,
        Some(Route::HomeAssistant) => crate::ha_relay::serve(client).await,
        Some(Route::Go2rtc(stream)) => crate::go2rtc::serve_mse(client, &stream).await,
        None => {}
    }
}

/// `/<token>/<route>` with a constant-time token comparison.
fn parse_route(path: &str, token: &str) -> Option<Route> {
    let (tok, seg) = path.strip_prefix('/')?.split_once('/')?;
    if !constant_time_eq(tok.as_bytes(), token.as_bytes()) {
        return None;
    }
    match seg {
        "gemini" => Some(Route::Gemini),
        "ha" => Some(Route::HomeAssistant),
        _ => seg
            .strip_prefix("go2rtc/")
            .filter(|s| crate::go2rtc::valid_stream_name(s))
            .map(|s| Route::Go2rtc(s.to_owned())),
    }
}

/// Pipes data frames both ways until either side ends. Ping/pong are answered
/// per hop by tungstenite; Close is forwarded so peers see the real code/reason.
pub(crate) async fn pipe<U>(client: ClientWs, upstream: U)
where
    U: Stream<Item = Result<Message, WsError>> + Sink<Message, Error = WsError> + Unpin,
{
    let (client_tx, client_rx) = client.split();
    let (upstream_tx, upstream_rx) = upstream.split();
    tokio::select! {
        _ = relay(client_rx, upstream_tx) => {}
        _ = relay(upstream_rx, client_tx) => {}
    }
}

async fn relay<St, Si>(mut from: St, mut to: Si)
where
    St: Stream<Item = Result<Message, WsError>> + Unpin,
    Si: Sink<Message, Error = WsError> + Unpin,
{
    while let Some(Ok(msg)) = from.next().await {
        match msg {
            Message::Text(_) | Message::Binary(_) => {
                if to.send(msg).await.is_err() {
                    return;
                }
            }
            Message::Close(frame) => {
                let _ = to.send(Message::Close(frame)).await;
                return;
            }
            Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => {}
        }
    }
    let _ = to.close().await;
}

/// Closes the client with an application code (4000–4999). `reason` must never contain a secret.
pub(crate) async fn reject(mut client: ClientWs, code: u16, reason: &str) {
    let frame = CloseFrame { code: CloseCode::from(code), reason: reason.to_owned().into() };
    let _ = client.close(Some(frame)).await;
}

fn origin_allowed(origin: &str) -> bool {
    ALLOWED_ORIGINS.contains(&origin) || DEV_ORIGINS.contains(&origin)
}

fn random_token() -> std::io::Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| std::io::Error::other(e.to_string()))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
#[path = "relay_server_tests.rs"]
mod tests;
