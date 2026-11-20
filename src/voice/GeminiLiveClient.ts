import { errorMessage } from '../core/DeviceProvider';
import { parseJson } from '../core/json';
import type { JsonObject } from '../core/types';
import {
  buildAudioMessage,
  buildAudioStreamEnd,
  buildSetupMessage,
  buildToolResponse,
  parseServerMessage,
  type FunctionResponse,
  type LiveSetupOptions,
  type ServerMessage,
} from './protocol';

/** Close codes sent by the Rust relay (must match src-tauri/src/gemini_proxy.rs). */
export const PROXY_CLOSE = { noKey: 4001, keystore: 4002, upstream: 4003 } as const;

export interface GeminiLiveClientOptions extends LiveSetupOptions {
  /**
   * Local relay URL from `get_gemini_proxy_url` (`ws://127.0.0.1:<port>/<token>`).
   * The relay attaches the API key upstream; no credential ever exists in the webview.
   */
  readonly url: string;
  readonly setupTimeoutMs?: number;
}

export interface GeminiLiveHandlers {
  readonly onMessage: (msg: ServerMessage) => void;
  /** `code` is the WebSocket close code (0 when closed locally). */
  readonly onClose: (reason: string, code: number) => void;
}

export type LiveClientState = 'idle' | 'connecting' | 'open' | 'closed';

/**
 * Thin WebSocket wrapper for `BidiGenerateContent`. `connect()` resolves once the
 * server acknowledges `setup`; all frames before that are rejected by the server.
 */
export class GeminiLiveClient {
  private ws: WebSocket | null = null;
  private currentState: LiveClientState = 'idle';
  private readonly decoder = new TextDecoder();

  constructor(
    private readonly options: GeminiLiveClientOptions,
    private readonly handlers: GeminiLiveHandlers,
  ) {}

  get state(): LiveClientState {
    return this.currentState;
  }

  connect(): Promise<void> {
    if (this.currentState === 'open' || this.currentState === 'connecting') {
      return Promise.reject(new Error(`Live client already ${this.currentState}`));
    }
    this.currentState = 'connecting';
    const ws = new WebSocket(this.options.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (err?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      };
      const timer = setTimeout(() => {
        settle(new Error('Gemini Live setup timed out'));
        this.close('setup timeout');
        // Covers the relay's own upstream connect (≤10s) plus setup.
      }, this.options.setupTimeoutMs ?? 15_000);

      ws.onopen = () => this.sendJson(buildSetupMessage(this.options));
      ws.onmessage = (ev: MessageEvent<string | ArrayBuffer>) => {
        for (const msg of this.decode(ev.data)) {
          if (msg.kind === 'setup_complete') {
            this.currentState = 'open';
            settle();
          }
          try {
            this.handlers.onMessage(msg);
          } catch (err: unknown) {
            console.error('[gemini-live] handler threw', err);
          }
        }
      };
      ws.onerror = () => settle(new Error('Gemini Live WebSocket error'));
      ws.onclose = (ev) => {
        const reason = ev.reason || `code ${ev.code}`;
        settle(new Error(ev.reason || `Gemini Live closed during setup (code ${ev.code})`));
        if (this.ws === ws) this.finish(reason, ev.code);
      };
    });
  }

  /** Base64 16kHz PCM. Dropped silently unless the session is open. */
  sendAudio(base64Pcm: string): void {
    if (this.currentState === 'open') this.sendJson(buildAudioMessage(base64Pcm));
  }

  endAudioStream(): void {
    if (this.currentState === 'open') this.sendJson(buildAudioStreamEnd());
  }

  sendToolResponse(responses: readonly FunctionResponse[]): void {
    if (this.currentState === 'open' && responses.length) this.sendJson(buildToolResponse(responses));
  }

  close(reason = 'client closed'): void {
    const ws = this.ws;
    if (!ws) return;
    this.finish(reason);
    try {
      ws.close(1000, reason.slice(0, 120));
    } catch (err: unknown) {
      console.warn('[gemini-live] close failed', errorMessage(err));
    }
  }

  private finish(reason: string, code = 0): void {
    const ws = this.ws;
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    this.ws = null;
    this.currentState = 'closed';
    this.handlers.onClose(reason, code);
  }

  private sendJson(msg: JsonObject): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** The Live API sends JSON in both text and binary frames. */
  private decode(data: string | ArrayBuffer): ServerMessage[] {
    const text = typeof data === 'string' ? data : this.decoder.decode(data);
    return parseServerMessage(parseJson(text));
  }
}
