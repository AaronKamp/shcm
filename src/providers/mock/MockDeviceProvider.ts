import { BaseDeviceProvider, commandError, commandOk } from '../../core/DeviceProvider';
import { num, slugify } from '../../core/json';
import {
  makeUid,
  type CameraStream,
  type CommandResult,
  type DeviceCommand,
  type JsonObject,
  type ProviderId,
  type SmartEntity,
} from '../../core/types';
import type { BrowseRequest, MediaItem, SearchRequest } from '../../core/media';
import { MOCK_ACTION_STATES, MOCK_CAMERAS, MOCK_ENTITIES } from './mockFixtures';
import { mockBrowse, mockSearch } from './mockLibrary';
import { applyMediaAction, clamp } from './mockMedia';

export interface MockDeviceProviderOptions {
  /** Provider id to register under. Use `home_assistant` to stand in for HA offline. Default `mock`. */
  readonly id?: ProviderId;
  /** Interval between simulated state changes. 0 disables the simulation. Default 2000ms. */
  readonly tickMs?: number;
  /** Simulated command/connect latency. Default 150ms. */
  readonly latencyMs?: number;
  /** Seed for deterministic simulations (tests, screenshots). */
  readonly seed?: number;
  /**
   * Optional local go2rtc base URL (e.g. `http://127.0.0.1:1984`). When set, cameras offer a
   * WHEP stream `/api/webrtc?src=<slug>` before the synthetic test pattern. Unset = zero network.
   */
  readonly go2rtcUrl?: string;
}

/** Offline provider that emits simulated state changes and camera URLs. Never hits live endpoints. */
export class MockDeviceProvider extends BaseDeviceProvider {
  readonly id: ProviderId;
  readonly displayName = 'Mock Devices';

  private timer: ReturnType<typeof setInterval> | null = null;
  private rngState: number;
  private readonly tickMs: number;
  private readonly latencyMs: number;
  private readonly go2rtcUrl: string | undefined;

  constructor(options: MockDeviceProviderOptions = {}) {
    super();
    this.id = options.id ?? 'mock';
    this.tickMs = options.tickMs ?? 2000;
    this.latencyMs = options.latencyMs ?? 150;
    this.rngState = (options.seed ?? 0x5eed) >>> 0;
    this.go2rtcUrl = options.go2rtcUrl?.replace(/\/+$/, '');
  }

  async connect(): Promise<void> {
    this.setStatus('connecting');
    await this.delay();
    const now = Date.now();
    for (const seed of MOCK_ENTITIES) {
      this.upsertEntity({
        uid: makeUid(this.id, seed.id),
        nativeId: seed.id,
        providerId: this.id,
        domain: seed.domain,
        name: seed.name,
        state: seed.state,
        attributes: { ...seed.attributes, friendly_name: seed.name },
        lastChanged: now,
        lastUpdated: now,
        available: true,
        area: seed.area,
      });
    }
    for (const seed of MOCK_CAMERAS) this.upsertCamera(this.buildCamera(seed.id, seed.name, true));
    this.setStatus('connected');
    if (this.tickMs > 0) this.timer = setInterval(() => this.tick(), this.tickMs);
  }

  async disconnect(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.clearSnapshot();
    this.setStatus('disconnected');
  }

  async executeCommand(command: DeviceCommand): Promise<CommandResult> {
    await this.delay();
    const entity = this.entities.get(makeUid(this.id, command.targetId));
    if (!entity) return commandError(`Unknown mock entity "${command.targetId}"`);
    if (entity.domain !== command.domain) return commandError(`Entity is "${entity.domain}", not "${command.domain}"`);

    const payload = command.payload ?? {};
    const attrs: JsonObject = { ...entity.attributes };
    const mapped = MOCK_ACTION_STATES[`${command.domain}.${command.action}`];
    let state = mapped ?? entity.state;
    let handled = mapped !== undefined;

    if (command.action === 'toggle') {
      state = entity.state === 'on' ? 'off' : 'on';
      handled = true;
    }
    if (command.domain === 'climate' && command.action === 'set_temperature') {
      const t = num(payload['temperature']);
      if (t === undefined) return commandError('set_temperature requires payload.temperature');
      attrs['temperature'] = t;
      handled = true;
    }
    if (command.domain === 'media_player') {
      const res = applyMediaAction(command.action, payload, attrs);
      if (typeof res === 'string') return commandError(res);
      handled ||= res;
    }
    if (!handled) return commandError(`Unsupported mock action "${command.domain}.${command.action}"`);
    if (command.domain === 'light') {
      const brightness = num(payload['brightness']);
      if (brightness !== undefined) attrs['brightness'] = clamp(brightness, 0, 255);
      if (state === 'off') attrs['brightness'] = 0;
      else if (attrs['brightness'] === 0) attrs['brightness'] = 255;
    }
    this.applyChange(entity, state, attrs);
    return commandOk(`[mock] ${command.domain}.${command.action} → ${command.targetId}`);
  }

  /** Libraries exist only on the mock Spotify / Music Assistant players; only Music Assistant searches. */
  async browseMedia(targetId: string, request: BrowseRequest): Promise<MediaItem> {
    await this.delay();
    const player = this.entities.get(makeUid(this.id, targetId));
    const hasLibrary = player !== undefined && (targetId.includes('spotify') || 'mass_player_type' in player.attributes);
    const item = hasLibrary ? mockBrowse(request.contentId) : null;
    if (!item) throw new Error(hasLibrary ? `Nothing at "${request.contentId ?? ''}"` : `${player?.name ?? targetId} doesn't offer a library`);
    return item;
  }

  searchMedia = (_targetId: string, request: SearchRequest): Promise<MediaItem[]> => this.delay().then(() => mockSearch(request.query, request.classes));

  /** Test hook: force a specific state immediately. */
  simulate(nativeId: string, state: string, attributes?: JsonObject): void {
    const entity = this.entities.get(makeUid(this.id, nativeId));
    if (entity) this.applyChange(entity, state, attributes ?? entity.attributes);
  }

  /** Test hook: toggle a camera online/offline. */
  setCameraOnline(nativeId: string, online: boolean): void {
    const cam = this.cameras.get(makeUid(this.id, nativeId));
    if (cam) this.upsertCamera({ ...cam, online });
  }

  private tick(): void {
    const roll = this.random();
    const now = Date.now();
    if (roll < 0.35) {
      const temp = this.entities.get(makeUid(this.id, 'sensor.outdoor_temp'));
      if (temp) this.applyChange(temp, (Number(temp.state) + (this.random() - 0.5)).toFixed(1), temp.attributes);
    } else if (roll < 0.6) {
      const motion = this.entities.get(makeUid(this.id, 'binary_sensor.driveway_motion'));
      if (motion) {
        const next = motion.state === 'on' ? 'off' : 'on';
        this.applyChange(motion, next, motion.attributes);
        const cam = this.cameras.get(makeUid(this.id, 'cam_driveway'));
        if (cam && next === 'on') this.upsertCamera({ ...cam, lastMotion: now });
      }
    } else if (roll < 0.8) {
      const climate = this.entities.get(makeUid(this.id, 'climate.main'));
      if (climate) {
        const cur = num(climate.attributes['current_temperature']) ?? 70;
        const target = num(climate.attributes['temperature']) ?? 70;
        const step = Math.sign(target - cur) * 0.5;
        this.applyChange(climate, climate.state, { ...climate.attributes, current_temperature: cur + step });
      }
    } else if (roll < 0.9) {
      const idx = Math.floor(this.random() * MOCK_CAMERAS.length);
      const seed = MOCK_CAMERAS[idx];
      const cam = seed ? this.cameras.get(makeUid(this.id, seed.id)) : undefined;
      if (cam) this.upsertCamera({ ...cam, online: !cam.online });
    } else {
      const vac = this.entities.get(makeUid(this.id, 'vacuum.roborock'));
      if (vac && vac.state === 'cleaning') {
        const battery = Math.max(0, (num(vac.attributes['battery_level']) ?? 100) - 3);
        this.applyChange(vac, battery < 20 ? 'returning' : 'cleaning', { ...vac.attributes, battery_level: battery });
      }
    }
  }

  private applyChange(entity: SmartEntity, state: string, attributes: JsonObject): void {
    const now = Date.now();
    this.upsertEntity({
      ...entity,
      state,
      attributes,
      lastChanged: state === entity.state ? entity.lastChanged : now,
      lastUpdated: now,
    });
  }

  private buildCamera(nativeId: string, name: string, online: boolean): CameraStream {
    const slug = slugify(name);
    const streams: CameraStream['streams'] = [];
    if (this.go2rtcUrl) {
      streams.push({ protocol: 'webrtc', url: `${this.go2rtcUrl}/api/webrtc?src=${encodeURIComponent(slug)}`, quality: 'high' });
    }
    streams.push({ protocol: 'test_pattern', url: `testpattern://${slug}`, quality: 'low' });
    return { uid: makeUid(this.id, nativeId), nativeId, providerId: this.id, name, slug, online, streams };
  }

  /** Mulberry32 PRNG: deterministic for a given seed. */
  private random(): number {
    this.rngState = (this.rngState + 0x6d2b79f5) >>> 0;
    let t = this.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private delay(): Promise<void> {
    return this.latencyMs > 0 ? new Promise((r) => setTimeout(r, this.latencyMs)) : Promise.resolve();
  }
}

