import { BaseDeviceProvider, commandError, commandOk, errorMessage } from '../core/DeviceProvider';
import { isRecord, slugify, str } from '../core/json';
import {
  GO2RTC_STREAM_PREFIX,
  makeUid,
  type CameraStream,
  type CameraStreamUrl,
  type CommandResult,
  type DeviceCommand,
} from '../core/types';

type Quality = CameraStreamUrl['quality'];

/**
 * Calls `<console>/proxy/protect/integration/v1<path>` and resolves with the JSON body.
 * In the app this is the Rust `unifi_request` command, which holds the console URL
 * and API key (OS credential store) and pins the console's self-signed certificate.
 * RTSPS stream endpoints are not reachable through it.
 */
export type UnifiTransport = (method: 'GET' | 'POST', path: string, body?: Record<string, unknown>) => Promise<unknown>;

export interface BridgedStream {
  readonly quality: Quality;
  /** go2rtc stream name; the RTSPS URL behind it stays in Rust. */
  readonly stream: string;
}

/**
 * Makes a camera playable in the webview: Rust fetches/creates the camera's
 * `rtsps://<console>:7441/…` streams, registers them with go2rtc as `rtspx://`,
 * and returns stream names to play over WebRTC (WHEP). `recreate` asks UniFi
 * for fresh RTSPS streams. In the app: the `unifi_bridge_streams` command.
 */
export type UnifiStreamBridge = (cameraId: string, recreate: boolean) => Promise<readonly BridgedStream[]>;

export interface UnifiProtectConfig {
  readonly transport: UnifiTransport;
  /** Without a bridge cameras are listed but have no playable stream. */
  readonly streamBridge?: UnifiStreamBridge;
  /** Camera online/offline poll interval. Default 30s. */
  readonly pollIntervalMs?: number;
}

/** UniFi Protect provider: discovers cameras and exposes them as go2rtc WebRTC streams. */
export class UnifiProtectProvider extends BaseDeviceProvider {
  readonly id = 'unifi_protect';
  readonly displayName = 'UniFi Protect';

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private bridgeWarned = false;

  constructor(private readonly config: UnifiProtectConfig) {
    super();
  }

  async connect(): Promise<void> {
    this.setStatus('connecting');
    try {
      await this.refreshCameras(true);
      this.setStatus('connected');
    } catch (err: unknown) {
      this.setStatus('error', errorMessage(err));
      throw err;
    }
    this.pollTimer = setInterval(() => {
      this.refreshCameras(false).catch((err: unknown) => this.setStatus('error', errorMessage(err)));
    }, this.config.pollIntervalMs ?? 30_000);
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.setStatus('disconnected');
  }

  async executeCommand(command: DeviceCommand): Promise<CommandResult> {
    if (command.domain !== 'camera') return commandError(`Unsupported domain "${command.domain}"`);
    const camera = this.cameras.get(makeUid(this.id, command.targetId));
    if (!camera) return commandError(`Unknown camera "${command.targetId}"`);
    switch (command.action) {
      case 'refresh_stream': {
        const bridge = this.config.streamBridge;
        if (!bridge) return commandError('No video bridge configured');
        const streams = toStreamUrls(await bridge(camera.nativeId, true));
        const { streamError: _cleared, ...rest } = camera;
        this.upsertCamera({ ...rest, streams });
        return commandOk(`Refreshed ${streams.length} stream(s)`);
      }
      default:
        return commandError(`Unsupported camera action "${command.action}"`);
    }
  }

  private async refreshCameras(withStreams: boolean): Promise<void> {
    const list = await this.config.transport('GET', '/cameras');
    if (!Array.isArray(list)) throw new Error('Unexpected /cameras response');
    const seen = new Set<string>();
    for (const raw of list) {
      if (!isRecord(raw)) continue;
      const nativeId = str(raw['id']);
      if (!nativeId) continue;
      const uid = makeUid(this.id, nativeId);
      seen.add(uid);
      const existing = this.cameras.get(uid);
      const name = str(raw['name'], nativeId);
      const online = str(raw['state']).toUpperCase() === 'CONNECTED';
      // Offline cameras aren't bridged (their RTSPS links just time out); they are
      // picked up on the first poll after they reconnect, since they have no streams.
      const reload = online && (withStreams || !existing || existing.streams.length === 0);
      const loaded = reload ? await this.loadStreams(nativeId) : null;
      const streamError = loaded ? loaded.error : existing?.streamError;
      const camera: CameraStream = {
        uid,
        nativeId,
        providerId: this.id,
        name,
        slug: slugify(name),
        online,
        streams: loaded ? loaded.streams : (existing?.streams ?? []),
        ...(streamError ? { streamError } : {}),
      };
      const changed =
        !existing ||
        existing.online !== camera.online ||
        existing.name !== camera.name ||
        existing.streamError !== camera.streamError ||
        streamKey(existing.streams) !== streamKey(camera.streams);
      if (changed) {
        this.upsertCamera(camera);
      }
    }
    for (const uid of [...this.cameras.keys()]) if (!seen.has(uid)) this.removeCamera(uid);
  }

  /** One camera's bridge failure (e.g. go2rtc unreachable) never hides the others. */
  private async loadStreams(cameraId: string): Promise<{ streams: CameraStreamUrl[]; error: string | null }> {
    const bridge = this.config.streamBridge;
    if (!bridge) return { streams: [], error: 'No video bridge configured' };
    try {
      return { streams: toStreamUrls(await bridge(cameraId, false)), error: null };
    } catch (err: unknown) {
      const error = errorMessage(err);
      if (!this.bridgeWarned) console.warn(`[unifi] video bridge unavailable: ${error}`);
      this.bridgeWarned = true;
      return { streams: [], error };
    }
  }
}

const streamKey = (streams: readonly CameraStreamUrl[]): string => streams.map((s) => s.url).join('\n');

const toStreamUrls = (bridged: readonly BridgedStream[]): CameraStreamUrl[] =>
  bridged.map((b) => ({ protocol: 'webrtc', url: `${GO2RTC_STREAM_PREFIX}${b.stream}`, quality: b.quality }));
