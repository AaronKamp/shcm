import { GO2RTC_STREAM_PREFIX } from '../../core/types';
import { bridgeWhep } from '../../platform/videoBridge';

/**
 * Minimal WHEP (WebRTC-HTTP Egress) client, compatible with go2rtc
 * `POST /api/webrtc?src=<name>` and MediaMTX `/<path>/whep`.
 * Non-trickle: we gather ICE first, then send one offer.
 *
 * `go2rtc:<stream>` URLs (UniFi via the Rust bridge) signal through the
 * `go2rtc_whep` command; only the SDP crosses IPC, the media is direct WebRTC.
 */

export interface WhepSession {
  readonly stream: MediaStream;
  close(): void;
}

/** Chromium-only receiver knobs for minimum latency; not yet in lib.dom. */
type LowLatencyReceiver = RTCRtpReceiver & { jitterBufferTarget?: number | null; playoutDelayHint?: number };

const waitForIce = (pc: RTCPeerConnection, timeoutMs: number): Promise<void> =>
  new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = (): void => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = (): void => {
      if (pc.iceGatheringState === 'complete') done();
    };
    // Host candidates are enough on a LAN; don't wait on slow STUN.
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
  });

const waitForMedia = (pc: RTCPeerConnection, stream: MediaStream, timeoutMs: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      pc.removeEventListener('connectionstatechange', onState);
      signal.removeEventListener('abort', onAbort);
    };
    const onState = (): void => {
      if (pc.connectionState === 'connected' && stream.getVideoTracks().length > 0) {
        cleanup();
        resolve();
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        cleanup();
        reject(new Error(`WebRTC ${pc.connectionState}`));
      }
    };
    const onAbort = (): void => {
      cleanup();
      reject(new DOMException('aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('WebRTC media timeout'));
    }, timeoutMs);
    pc.addEventListener('connectionstatechange', onState);
    signal.addEventListener('abort', onAbort);
    onState();
  });

/**
 * go2rtc matched audio only (or nothing): the camera's video codec — in practice
 * H.265 — isn't one this webview negotiates over WebRTC. Callers fall back to MSE.
 */
export class UnsupportedVideoCodecError extends Error {
  constructor() {
    super('Camera video codec (likely H.265) is not playable over WebRTC here');
    this.name = 'UnsupportedVideoCodecError';
  }
}

/** True when the SDP answer accepts a video m-line (not port 0, not inactive). */
export const answerHasVideo = (sdp: string): boolean =>
  sdp
    .split(/\r?\n(?=m=)/)
    .some((section) => /^m=video [1-9]/.test(section) && !/\r?\na=inactive\b/.test(section));

export const connectWhep = async (
  url: string,
  signal: AbortSignal,
  onLost: () => void,
  timeoutMs = 8000,
): Promise<WhepSession> => {
  const pc = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
  const stream = new MediaStream();
  let resourceUrl: string | null = null;

  const close = (): void => {
    for (const t of stream.getTracks()) t.stop();
    pc.close();
    // WHEP teardown is best-effort; go2rtc ignores it, MediaMTX frees the session.
    if (resourceUrl) fetch(resourceUrl, { method: 'DELETE' }).catch(() => undefined);
  };

  try {
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.ontrack = (ev) => {
      stream.addTrack(ev.track);
      const receiver = ev.receiver as LowLatencyReceiver;
      receiver.jitterBufferTarget = 0;
      receiver.playoutDelayHint = 0;
    };

    await pc.setLocalDescription(await pc.createOffer());
    await waitForIce(pc, 1000);
    const offer = pc.localDescription?.sdp;
    if (!offer) throw new Error('Failed to create SDP offer');

    let answer: string;
    if (url.startsWith(GO2RTC_STREAM_PREFIX)) {
      answer = await bridgeWhep(url.slice(GO2RTC_STREAM_PREFIX.length), offer);
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    } else {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: offer, signal });
      if (!res.ok) throw new Error(`WHEP ${res.status} ${res.statusText}`);
      const location = res.headers.get('Location');
      if (location) resourceUrl = new URL(location, url).toString();
      answer = await res.text();
    }

    if (!answerHasVideo(answer)) throw new UnsupportedVideoCodecError();
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });
    await waitForMedia(pc, stream, timeoutMs, signal);
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') onLost();
    });
    return { stream, close };
  } catch (err: unknown) {
    close();
    throw err;
  }
};
