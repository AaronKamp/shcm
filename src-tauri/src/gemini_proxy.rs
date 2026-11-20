//! `/<token>/gemini` route: attaches the Gemini API key from the OS credential
//! store and pipes Live API frames verbatim (no JSON re-parsing).

use std::time::Duration;

use tokio::time::timeout;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Error as WsError;

use crate::relay_server::{pipe, reject, ClientWs};
use crate::secrets::{get_secret, SecretKind};

const UPSTREAM: &str =
    "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent";
const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(10);

/// Close codes the frontend maps to UI (see `PROXY_CLOSE` in src/voice/GeminiLiveClient.ts).
const CLOSE_NO_KEY: u16 = 4001;
const CLOSE_KEYSTORE: u16 = 4002;
const CLOSE_UPSTREAM: u16 = 4003;

pub(crate) async fn serve(client: ClientWs) {
    let key = match tauri::async_runtime::spawn_blocking(|| get_secret(SecretKind::GeminiApiKey)).await {
        Ok(Ok(Some(key))) => key,
        Ok(Ok(None)) => return reject(client, CLOSE_NO_KEY, "Gemini API key not set").await,
        _ => return reject(client, CLOSE_KEYSTORE, "Credential store unavailable").await,
    };

    let upstream = match timeout(UPSTREAM_TIMEOUT, connect_async(format!("{UPSTREAM}?key={key}"))).await {
        Ok(Ok((ws, _))) => ws,
        // Never surface tungstenite's error text: URL errors would echo the key.
        Ok(Err(WsError::Http(resp))) => {
            let reason = format!("Gemini rejected the connection (HTTP {})", resp.status().as_u16());
            return reject(client, CLOSE_UPSTREAM, &reason).await;
        }
        Ok(Err(_)) => return reject(client, CLOSE_UPSTREAM, "Could not reach Gemini").await,
        Err(_) => return reject(client, CLOSE_UPSTREAM, "Gemini connection timed out").await,
    };
    drop(key);
    pipe(client, upstream).await;
}
