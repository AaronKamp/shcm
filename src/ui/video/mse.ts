import { isRecord, str } from '../../core/json';
import { getGo2rtcMseUrl } from '../../platform/videoBridge';

/**
 * go2rtc MSE client (fMP4 over WebSocket, via the Rust loopback relay).
 * Used for H.265 cameras: WebView2 decodes HEVC in MSE on the GPU, but doesn't
 * negotiate it over WebRTC. Protocol: we send `{type:"mse", value:<codecs we can
 * play>}`, go2rtc answers `{type:"mse", value:<mime>}` then streams fMP4 segments.
 */

/** Relay close codes (see go2rtc.rs). */
export const MSE_CLOSE = { notConfigured: 4020, upstream: 4021 } as const;

const CODECS = ['avc1.640029', 'avc1.64002A', 'avc1.640033', 'hvc1.1.6.L153.B0', 'mp4a.40.2', 'mp4a.40.5', 'flac', 'opus'];
/** Keep at most this much media behind the live edge. */
const KEEP_S = 6;
/** Jump to live if playback falls this far behind (e.g. after the tab was busy). */
const MAX_LAG_S = 1.5;
/** Cap on data queued before the video element attaches. */
const MAX_QUEUED_BYTES = 8 * 1024 * 1024;

export interface MseSession {
  readonly mime: string;
  /** Plays into `video`; returns a detach function. One video at a time. */
  attach(video: HTMLVideoElement): () => void;
  close(): void;
}

const supportedCodecs = (): string =>
  typeof MediaSource === 'undefined'
    ? ''
    : CODECS.filter((c) => MediaSource.isTypeSupported(`video/mp4; codecs="${c}"`)).join();

const concat = (chunks: readonly ArrayBuffer[]): ArrayBuffer => {
  if (chunks.length === 1 && chunks[0]) return chunks[0];
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(new Uint8Array(c), offset);
    offset += c.byteLength;
  }
  return out.buffer;
};

/** Opens the stream and resolves once go2rtc has picked a codec we can decode. */
export const connectMse = async (stream: string, signal: AbortSignal, onLost: () => void, timeoutMs = 8000): Promise<MseSession> => {
  const codecs = supportedCodecs();
  if (!codecs) throw new Error('This webview has no MSE support');
  const ws = new WebSocket(await getGo2rtcMseUrl(stream));
  ws.binaryType = 'arraybuffer';

  let queued: ArrayBuffer[] = [];
  let queuedBytes = 0;
  let sink: ((chunk: ArrayBuffer) => void) | null = null;
  let closed = false;

  const mime = await new Promise<string>((resolve, reject) => {
    const finish = (err: Error | null, value = ''): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve(value);
    };
    const onAbort = (): void => finish(new DOMException('aborted', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('go2rtc MSE timeout')), timeoutMs);
    signal.addEventListener('abort', onAbort);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'mse', value: codecs }));
    ws.onclose = (ev) => finish(new Error(ev.reason || `go2rtc MSE closed (${ev.code})`));
    ws.onmessage = (ev: MessageEvent<unknown>) => {
      if (typeof ev.data !== 'string') return;
      let msg: unknown;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!isRecord(msg)) return;
      if (msg['type'] === 'mse') finish(null, str(msg['value']));
      else if (msg['type'] === 'error') finish(new Error(`go2rtc: ${str(msg['value'])}`));
    };
  }).catch((err: unknown) => {
    ws.close();
    throw err;
  });

  if (!MediaSource.isTypeSupported(mime)) {
    ws.close();
    throw new Error(`Can't decode ${mime} in this webview`);
  }

  ws.onmessage = (ev: MessageEvent<unknown>) => {
    if (!(ev.data instanceof ArrayBuffer)) return;
    if (sink) return sink(ev.data);
    // Before attach: keep the init segment + early media, bounded.
    if (queuedBytes + ev.data.byteLength <= MAX_QUEUED_BYTES) {
      queued.push(ev.data);
      queuedBytes += ev.data.byteLength;
    }
  };
  ws.onclose = () => {
    if (!closed) onLost();
  };

  const attach = (video: HTMLVideoElement): (() => void) => {
    const ms = new MediaSource();
    const url = URL.createObjectURL(ms);
    let sb: SourceBuffer | null = null;
    const pending = queued;
    queued = [];
    queuedBytes = 0;

    const pump = (): void => {
      if (!sb || sb.updating || ms.readyState !== 'open') return;
      if (pending.length) {
        try {
          sb.appendBuffer(concat(pending.splice(0)));
        } catch {
          // QuotaExceeded or a bad segment: drop it; the next keyframe recovers.
        }
        return;
      }
      const b = sb.buffered;
      if (!b.length) return;
      const start = b.start(0);
      const end = b.end(b.length - 1);
      if (end - start > KEEP_S * 2) {
        sb.remove(start, end - KEEP_S);
        return;
      }
      if (video.currentTime < start || end - video.currentTime > MAX_LAG_S) video.currentTime = Math.max(start, end - 0.3);
      // Gently catch up instead of letting latency build.
      video.playbackRate = end - video.currentTime > 0.6 ? 1.1 : 1;
    };

    ms.addEventListener(
      'sourceopen',
      () => {
        URL.revokeObjectURL(url);
        sb = ms.addSourceBuffer(mime);
        sb.mode = 'segments';
        sb.addEventListener('updateend', pump);
        pump();
      },
      { once: true },
    );
    sink = (chunk) => {
      pending.push(chunk);
      pump();
    };
    video.src = url;
    video.play().catch(() => undefined);

    return () => {
      sink = null;
      sb = null;
      video.pause();
      video.removeAttribute('src');
      video.load(); // releases the decoder
    };
  };

  return {
    mime,
    attach,
    close: () => {
      closed = true;
      sink = null;
      ws.close();
    },
  };
};
