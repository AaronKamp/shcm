import { useEffect, useMemo, useState } from 'react';
import { GO2RTC_STREAM_PREFIX, type CameraStreamUrl } from '../../core/types';
import { connectMse, type MseSession } from './mse';
import { connectWhep, UnsupportedVideoCodecError } from './whep';

export type PlayerStatus = 'idle' | 'connecting' | 'playing' | 'paused' | 'offline' | 'error';

export interface PlayerState {
  readonly status: PlayerStatus;
  /** The stream currently being rendered (null while paused / failed). */
  readonly source: CameraStreamUrl | null;
  /** Live WebRTC media, for `webrtc` sources played over WebRTC. */
  readonly media: MediaStream | null;
  /** go2rtc MSE session (H.265 cameras); the tile attaches it to its <video>. */
  readonly mse: MseSession | null;
  readonly error: string | null;
}

/**
 * Protocols a webview can render directly. RTSP/RTSPS must be restreamed by
 * go2rtc (exposed as `webrtc`); HLS needs hls.js and adds seconds of latency.
 */
const PLAYABLE: ReadonlySet<CameraStreamUrl['protocol']> = new Set(['webrtc', 'mjpeg', 'test_pattern']);
const RETRY_MS = 10_000;

/** go2rtc streams whose video WebRTC can't carry here (H.265): go straight to MSE next time. */
const needsMse = new Set<string>();

const isCodecMismatch = (err: unknown): boolean =>
  err instanceof UnsupportedVideoCodecError || (err instanceof Error && err.message.includes('codecs not matched'));

const idle = (status: PlayerStatus, error: string | null = null): PlayerState => ({ status, source: null, media: null, mse: null, error });

/**
 * Owns the stream lifecycle for one tile. When `active` goes false, the peer
 * connection / WebSocket is closed and media released (decoder freed → ~0 CPU/GPU),
 * not just hidden. When it flips back, we reconnect from the most preferred source.
 * go2rtc streams try WebRTC first and fall back to MSE when the video is H.265.
 */
export const useStreamPlayer = (
  streams: readonly CameraStreamUrl[],
  active: boolean,
  online: boolean,
  /** Provider's reason for having no streams, shown instead of the generic hint. */
  streamError?: string,
): PlayerState => {
  const candidates = useMemo(() => streams.filter((s) => PLAYABLE.has(s.protocol)), [streams]);
  // Re-run only when the actual URLs change, not on every camera object refresh.
  const key = candidates.map((c) => `${c.protocol}|${c.url}`).join('\n');
  const [state, setState] = useState<PlayerState>(idle('idle'));
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (!online) {
      setState(idle('offline'));
      return;
    }
    if (!active) {
      setState((s) => idle('paused', s.error));
      return;
    }
    if (candidates.length === 0) {
      setState(idle('error', streamError ? `Video bridge: ${streamError}` : 'No playable stream — set the go2rtc URL in Integrations'));
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    let close: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRetry = (): void => {
      if (signal.aborted || retryTimer !== null) return;
      retryTimer = setTimeout(() => setRetryTick((n) => n + 1), RETRY_MS);
    };
    const onLost = (): void => {
      setState((s) => ({ ...s, status: 'connecting', error: 'Stream lost, reconnecting…' }));
      scheduleRetry();
    };

    const playMse = async (source: CameraStreamUrl, stream: string): Promise<void> => {
      const session = await connectMse(stream, signal, onLost);
      close = () => session.close();
      if (signal.aborted) return session.close();
      setState({ status: 'playing', source, media: null, mse: session, error: null });
    };

    const playWebrtc = async (source: CameraStreamUrl): Promise<void> => {
      const session = await connectWhep(source.url, signal, onLost);
      close = () => session.close();
      if (signal.aborted) return session.close();
      setState({ status: 'playing', source, media: session.stream, mse: null, error: null });
    };

    const run = async (): Promise<void> => {
      let lastError = 'All streams failed';
      for (const source of candidates) {
        if (signal.aborted) return;
        setState({ status: 'connecting', source, media: null, mse: null, error: null });
        if (source.protocol !== 'webrtc') {
          setState({ status: 'playing', source, media: null, mse: null, error: null });
          return;
        }
        const go2rtc = source.url.startsWith(GO2RTC_STREAM_PREFIX) ? source.url.slice(GO2RTC_STREAM_PREFIX.length) : null;
        try {
          if (go2rtc && needsMse.has(go2rtc)) return await playMse(source, go2rtc);
          try {
            return await playWebrtc(source);
          } catch (err: unknown) {
            if (!go2rtc || !isCodecMismatch(err)) throw err;
            needsMse.add(go2rtc);
            return await playMse(source, go2rtc);
          }
        } catch (err: unknown) {
          if (signal.aborted) return;
          lastError = err instanceof Error ? err.message : String(err);
        }
      }
      setState(idle('error', lastError));
      scheduleRetry();
    };
    void run();

    return () => {
      controller.abort();
      if (retryTimer !== null) clearTimeout(retryTimer);
      close?.();
      close = null;
    };
    // `key` stands in for `candidates` so object identity churn doesn't reconnect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active, online, retryTick, streamError]);

  return state;
};
