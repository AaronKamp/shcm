import { invoke } from '@tauri-apps/api/core';
import { isRecord, str } from '../core/json';
import type { BridgedStream, UnifiStreamBridge } from '../providers/UnifiProtectProvider';

const parseBridged = (raw: unknown): BridgedStream[] =>
  Array.isArray(raw)
    ? raw.flatMap((r): BridgedStream[] => {
        if (!isRecord(r)) return [];
        const quality = str(r['quality']);
        const stream = str(r['stream']);
        return stream && (quality === 'high' || quality === 'medium' || quality === 'low')
          ? [{ quality, stream }]
          : [];
      })
    : [];

/** Rust registers the camera's RTSPS streams with go2rtc and returns stream names only. */
export const unifiStreamBridge: UnifiStreamBridge = async (cameraId, recreate) =>
  parseBridged(await invoke<unknown>('unifi_bridge_streams', { cameraId, recreate }));

/** WHEP offer → answer via Rust (go2rtc URL stays in the credential store; no CORS). */
export const bridgeWhep = (stream: string, offer: string): Promise<string> =>
  invoke<string>('go2rtc_whep', { stream, offer });

/** Loopback relay URL for go2rtc's MSE WebSocket (`/api/ws?src=<stream>`). */
export const getGo2rtcMseUrl = (stream: string): Promise<string> => invoke<string>('get_go2rtc_mse_url', { stream });
