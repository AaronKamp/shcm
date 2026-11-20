import { errorMessage } from '../../core/DeviceProvider';
import { isRecord, parseJson, str } from '../../core/json';

/**
 * How to reach HA. In the app this is always `relay`: the Rust relay holds the
 * URL + token (OS credential store), performs the auth handshake, and hands the
 * webview an already-authenticated socket. `direct` exists for tests/tools only.
 */
export type HomeAssistantEndpoint =
  | { readonly relay: () => Promise<string> }
  | {
      /** HA base URL (`http://homeassistant.local:8123`) or full `ws(s)://…/api/websocket`. */
      readonly url: string;
      readonly accessToken: string;
    };

/** Relay close codes (must match src-tauri/src/ha_relay.rs). 4010/4011 are not retried. */
export const HA_RELAY_CLOSE = { notConfigured: 4010, authRejected: 4011, upstream: 4012, keystore: 4013 } as const;

export type HomeAssistantConnectionConfig = HomeAssistantEndpoint & {
  readonly requestTimeoutMs?: number;
  /** Backoff: base * 2^attempt, capped, with ±25% jitter. */
  readonly reconnectBaseMs?: number;
  readonly reconnectMaxMs?: number;
  /** Ping interval to detect half-open sockets. 0 disables. Default 30s. */
  readonly heartbeatMs?: number;
};

export type ConnectionState = 'idle' | 'connecting' | 'authenticated' | 'reconnecting' | 'auth_failed' | 'closed';

export interface ConnectionHandlers {
  /** Called after every successful auth (first connect and each reconnect). */
  onAuthenticated: () => Promise<void>;
  /** Called for every `type: "event"` message, keyed by subscription id. */
  onEvent: (subscriptionId: number, event: unknown) => void;
  onStateChange: (state: ConnectionState, error?: string) => void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Converts a base or ws URL into the HA WebSocket endpoint. */
export const toWebSocketUrl = (url: string): string => {
  const u = new URL(url);
  if (u.protocol === 'http:') u.protocol = 'ws:';
  if (u.protocol === 'https:') u.protocol = 'wss:';
  if (!u.pathname.endsWith('/api/websocket')) u.pathname = `${u.pathname.replace(/\/+$/, '')}/api/websocket`;
  return u.toString();
};

/**
 * Transport for the HA WebSocket API: auth handshake, id-correlated requests,
 * heartbeat, and exponential-backoff reconnection. Knows nothing about entities.
 */
export class HomeAssistantConnection {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = true;

  constructor(
    private readonly config: HomeAssistantConnectionConfig,
    private readonly handlers: ConnectionHandlers,
  ) {}

  private resolveUrl(): Promise<string> {
    return 'relay' in this.config ? this.config.relay() : Promise.resolve(toWebSocketUrl(this.config.url));
  }

  /** Resolves after the first successful auth + `onAuthenticated`; rejects on auth failure or first-connect error. */
  start(): Promise<void> {
    this.stopped = false;
    this.attempt = 0;
    return this.open();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000, 'client stop');
    this.rejectAll('connection stopped');
    this.handlers.onStateChange('closed');
  }

  /** Sends a command and resolves with its `result` payload. */
  request(payload: Record<string, unknown>): Promise<unknown> {
    return this.send(payload).result;
  }

  /** Returns the subscription id used to route `event` messages. */
  async subscribe(payload: Record<string, unknown>): Promise<number> {
    const { id, result } = this.send(payload);
    await result;
    return id;
  }

  private send(payload: Record<string, unknown>): { id: number; result: Promise<unknown> } {
    const ws = this.ws;
    const id = this.nextId++;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return { id, result: Promise.reject(new Error('Home Assistant not connected')) };
    }
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Home Assistant request "${str(payload['type'])}" timed out`));
      }, this.config.requestTimeoutMs ?? 10_000);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ ...payload, id }));
    });
    return { id, result };
  }

  private async open(): Promise<void> {
    this.handlers.onStateChange(this.attempt > 0 ? 'reconnecting' : 'connecting');
    let wsUrl: string;
    try {
      wsUrl = await this.resolveUrl();
    } catch (err: unknown) {
      if (!this.stopped) this.scheduleReconnect();
      throw err instanceof Error ? err : new Error(errorMessage(err));
    }
    if (this.stopped) throw new Error('connection stopped');
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (err?: Error): void => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onmessage = (ev: MessageEvent) => {
        const msg = parseJson(typeof ev.data === 'string' ? ev.data : '');
        if (!isRecord(msg)) return;
        const type = msg['type'];
        if (type === 'auth_required') {
          // Relay mode never sees this: Rust authenticates before handing over the socket.
          if ('accessToken' in this.config) ws.send(JSON.stringify({ type: 'auth', access_token: this.config.accessToken }));
          else ws.close(4000, 'unexpected auth_required');
        } else if (type === 'auth_invalid') {
          this.stopped = true; // never retry a bad token
          const reason = str(msg['message'], 'invalid access token');
          this.handlers.onStateChange('auth_failed', reason);
          ws.close();
          settle(new Error(`Home Assistant auth failed: ${reason}`));
        } else if (type === 'auth_ok') {
          this.attempt = 0;
          this.startHeartbeat();
          this.handlers
            .onAuthenticated()
            .then(() => {
              this.handlers.onStateChange('authenticated');
              settle();
            })
            .catch((err: unknown) => {
              settle(err instanceof Error ? err : new Error(errorMessage(err)));
              ws.close(4000, 'post-auth setup failed');
            });
        } else if (type === 'result' || type === 'pong') {
          this.resolvePending(msg);
        } else if (type === 'event') {
          this.handlers.onEvent(typeof msg['id'] === 'number' ? msg['id'] : -1, msg['event']);
        }
      };
      // Never log the URL: in relay mode it contains the relay's access token.
      ws.onerror = () => settle(new Error('Home Assistant WebSocket error'));
      ws.onclose = (ev: CloseEvent) => {
        if (this.ws === ws) this.ws = null;
        this.clearHeartbeat();
        this.rejectAll('connection closed');
        if (ev.code === HA_RELAY_CLOSE.notConfigured || ev.code === HA_RELAY_CLOSE.authRejected) {
          this.stopped = true; // retrying can't fix missing or rejected credentials
          this.handlers.onStateChange('auth_failed', ev.reason);
        }
        settle(new Error(ev.reason || `Home Assistant WebSocket closed (${ev.code})`));
        if (!this.stopped) this.scheduleReconnect();
      };
    });
  }

  private resolvePending(msg: Record<string, unknown>): void {
    const id = typeof msg['id'] === 'number' ? msg['id'] : -1;
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    if (msg['type'] === 'pong' || msg['success'] === true) p.resolve(msg['result']);
    else p.reject(new Error(isRecord(msg['error']) ? str(msg['error']['message'], 'request failed') : 'request failed'));
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.handlers.onStateChange('reconnecting');
    const base = this.config.reconnectBaseMs ?? 1000;
    const max = this.config.reconnectMaxMs ?? 30_000;
    const raw = Math.min(max, base * 2 ** this.attempt);
    const delay = Math.round(raw * (0.75 + Math.random() * 0.5));
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped) return;
      this.open().catch(() => {
        /* onclose schedules the next attempt */
      });
    }, delay);
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    const every = this.config.heartbeatMs ?? 30_000;
    if (every <= 0) return;
    this.heartbeatTimer = setInterval(() => {
      this.request({ type: 'ping' }).catch(() => this.ws?.close(4001, 'heartbeat timeout'));
    }, every);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private rejectAll(reason: string): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.clear();
  }
}
