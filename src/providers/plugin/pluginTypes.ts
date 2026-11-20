import type { EntityDomain, JsonObject, JsonValue, Unsubscribe } from '../../core/types';

/**
 * Config schema for non-HA devices. Strings may contain `{{…}}` placeholders:
 * `{{action}}`, `{{target}}`, `{{payload.<key>}}`, `{{env.<key>}}` (from `PluginProviderConfig.env`).
 * A JSON body value that is exactly `"{{payload.brightness}}"` keeps the raw type (number stays number).
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface HttpRequestSpec {
  readonly kind: 'http';
  readonly url: string;
  readonly method?: HttpMethod;
  readonly headers?: Readonly<Record<string, string>>;
  /** Object → JSON body; string → raw body. Omitted for GET. */
  readonly body?: JsonValue;
  readonly timeoutMs?: number;
}

export interface TcpRequestSpec {
  readonly kind: 'tcp';
  readonly host: string;
  readonly port: number;
  /** Text payload (after templating). With `encoding: 'hex'`, e.g. `"AA 01 FF"`. */
  readonly payload: string;
  readonly encoding?: 'utf8' | 'hex';
  /** Appended to utf8 payloads. Default `\r\n`. */
  readonly lineEnding?: string;
  /** How to read the reply. Default `line`. */
  readonly readUntil?: 'line' | 'close' | 'none';
  readonly timeoutMs?: number;
}

export interface MqttRequestSpec {
  readonly kind: 'mqtt';
  readonly topic: string;
  readonly payload?: JsonValue;
  readonly retain?: boolean;
  readonly qos?: 0 | 1 | 2;
}

export type PluginRequestSpec = HttpRequestSpec | TcpRequestSpec | MqttRequestSpec;

/** Turns a raw response into `{ state, attributes }`. */
export type StateParserSpec =
  | {
      readonly type: 'json';
      /** Dot path to the state value, e.g. `data.power`. */
      readonly stateField: string;
      /** Dot paths copied into attributes; key = last path segment. Omit to copy the whole object. */
      readonly attributeFields?: readonly string[];
      readonly map?: Readonly<Record<string, string>>;
    }
  | { readonly type: 'regex'; readonly pattern: string; readonly group?: number; readonly map?: Readonly<Record<string, string>> }
  | { readonly type: 'text'; readonly map?: Readonly<Record<string, string>> };

export type StateSourceSpec =
  | { readonly kind: 'poll'; readonly request: HttpRequestSpec | TcpRequestSpec; readonly intervalMs?: number; readonly parse: StateParserSpec }
  | { readonly kind: 'mqtt'; readonly topic: string; readonly parse: StateParserSpec };

export interface PluginCommandSpec {
  readonly request: PluginRequestSpec;
  /** Optimistic state applied after a successful send (e.g. `on`). */
  readonly resultState?: string;
  /** Optimistic attribute patch; values may be templates. */
  readonly resultAttributes?: JsonObject;
  /** Parse the command's own response into state (e.g. devices that echo status). */
  readonly parseResponse?: StateParserSpec;
}

export interface PluginDeviceSpec {
  /** Native id used as `target_id` in Gemini tool calls. Must be unique. */
  readonly id: string;
  readonly name: string;
  readonly domain: EntityDomain;
  readonly area?: string;
  readonly initialState?: string;
  readonly attributes?: JsonObject;
  /** action name → how to perform it, e.g. `{ turn_on: {...}, set_volume: {...} }`. */
  readonly commands: Readonly<Record<string, PluginCommandSpec>>;
  readonly state?: StateSourceSpec;
}

/** Raw TCP access. Webviews can't open sockets, so the app injects a Tauri/Rust-backed client. */
export interface TcpClient {
  request(options: {
    readonly host: string;
    readonly port: number;
    readonly data: Uint8Array;
    readonly readUntil: 'line' | 'close' | 'none';
    readonly timeoutMs: number;
  }): Promise<Uint8Array>;
}

/** Minimal MQTT client (mqtt.js over WebSocket, or a Tauri-side bridge). */
export interface MqttClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  publish(topic: string, payload: string, options?: { retain?: boolean; qos?: 0 | 1 | 2 }): Promise<void>;
  subscribe(topic: string, onMessage: (payload: string) => void): Unsubscribe;
}

export interface PluginTransports {
  readonly fetch?: typeof fetch;
  readonly tcp?: TcpClient;
  readonly mqtt?: MqttClient;
}

export interface PluginProviderConfig {
  readonly devices: readonly PluginDeviceSpec[];
  readonly transports?: PluginTransports;
  /** Values for `{{env.*}}` placeholders (tokens, hosts) kept out of device specs. */
  readonly env?: Readonly<Record<string, string>>;
  readonly defaultTimeoutMs?: number;
  readonly defaultPollMs?: number;
}

/** Values available to `{{…}}` placeholders. */
export interface TemplateContext {
  readonly action: string;
  readonly target: string;
  readonly payload: JsonObject;
  readonly env: Readonly<Record<string, string>>;
}

export interface ParsedState {
  readonly state: string;
  readonly attributes: JsonObject;
}
