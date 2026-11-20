/**
 * Core domain types shared by every DeviceProvider, the ProviderRegistry,
 * and (later) the UI and Gemini tool-call layer. No `any` allowed.
 */

/** Stable identifiers for built-in providers. Matches the Gemini tool enum where they overlap. */
export type ProviderId = 'home_assistant' | 'unifi_protect' | 'custom_hook' | 'mock' | (string & {});

export type ProviderStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'disconnected';

/** JSON-safe value used for entity attributes and command payloads. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** Device domains the app understands. Unknown domains pass through as strings. */
export type EntityDomain =
  | 'light'
  | 'switch'
  | 'lock'
  | 'climate'
  | 'media_player'
  | 'vacuum'
  | 'cover'
  | 'sensor'
  | 'binary_sensor'
  | 'camera'
  | 'webhook'
  | (string & {});

/** A single normalized device/entity, regardless of which backend it came from. */
export interface SmartEntity {
  /** Globally unique id: `${providerId}:${nativeId}`. */
  readonly uid: string;
  /** Id as known by the backend (e.g. HA entity_id `light.kitchen`). */
  readonly nativeId: string;
  readonly providerId: ProviderId;
  readonly domain: EntityDomain;
  name: string;
  /** Primary state, e.g. `on`, `off`, `locked`, `heat`, `cleaning`, `unavailable`. */
  state: string;
  attributes: JsonObject;
  /** Epoch milliseconds of the last state change. */
  lastChanged: number;
  /** Epoch milliseconds of the last update of state or attributes. */
  lastUpdated: number;
  available: boolean;
  /** Optional room/area label used for grouping in the UI. */
  area?: string;
  /** The backend marks it as config/diagnostic or hidden; dashboards leave it out. */
  secondary?: boolean;
  /** Integration that created it (HA registry `platform`, e.g. `spotify`, `music_assistant`, `cast`). */
  integration?: string;
}

/**
 * `webrtc` URLs are WHEP endpoints (e.g. go2rtc `/api/webrtc?src=<name>`).
 * `test_pattern` is a locally rendered synthetic feed emitted only by MockDeviceProvider.
 */
export type StreamProtocol = 'rtsp' | 'rtsps' | 'webrtc' | 'hls' | 'mjpeg' | 'test_pattern';

/**
 * `webrtc` URLs starting with this prefix name a go2rtc stream registered by the
 * Rust video bridge (`go2rtc:<stream>`); WHEP signaling then goes through Rust.
 */
export const GO2RTC_STREAM_PREFIX = 'go2rtc:';

export interface CameraStreamUrl {
  readonly protocol: StreamProtocol;
  readonly url: string;
  readonly quality: 'high' | 'medium' | 'low';
}

/** A live camera feed exposed by a provider (UniFi Protect, HA camera entity, mock). */
export interface CameraStream {
  /** Globally unique id: `${providerId}:${nativeId}`. */
  readonly uid: string;
  readonly nativeId: string;
  readonly providerId: ProviderId;
  name: string;
  /** Lowercase slug used for voice lookup, e.g. `driveway`, `front_door`. */
  slug: string;
  online: boolean;
  /** Ordered by preference; the UI picks the first protocol it can play. */
  streams: CameraStreamUrl[];
  /** Why `streams` is empty (e.g. the video bridge failed), shown on the tile. */
  streamError?: string;
  snapshotUrl?: string;
  /** Latest motion/smart-detect timestamp, epoch ms. */
  lastMotion?: number;
}

/** A command routed to a provider. Shape mirrors the `execute_smart_home_action` tool. */
export interface DeviceCommand {
  readonly providerId: ProviderId;
  readonly domain: EntityDomain;
  /** e.g. `turn_on`, `turn_off`, `set_volume`, `start`, `trigger`. */
  readonly action: string;
  /** Native entity / device id understood by the provider. */
  readonly targetId: string;
  readonly payload?: JsonObject;
}

export interface CommandResult {
  readonly ok: boolean;
  readonly message?: string;
  readonly data?: JsonValue;
}

/** Emitted by providers. The registry normalizes and throttles these before UI state. */
export type ProviderEvent =
  | { readonly type: 'entity_upsert'; readonly entity: SmartEntity }
  | { readonly type: 'entity_removed'; readonly uid: string }
  | { readonly type: 'camera_upsert'; readonly camera: CameraStream }
  | { readonly type: 'camera_removed'; readonly uid: string }
  | { readonly type: 'status'; readonly providerId: ProviderId; readonly status: ProviderStatus; readonly error?: string };

export type ProviderEventListener = (event: ProviderEvent) => void;

export type Unsubscribe = () => void;

export const makeUid = (providerId: ProviderId, nativeId: string): string => `${providerId}:${nativeId}`;
