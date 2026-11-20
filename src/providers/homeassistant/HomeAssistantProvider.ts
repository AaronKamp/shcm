import { BaseDeviceProvider, commandError, commandOk, errorMessage } from '../../core/DeviceProvider';
import { isRecord, parseTime, str, toJsonObject } from '../../core/json';
import { parseBrowseMedia, parseSearchResults, type BrowseRequest, type MediaItem, type SearchRequest } from '../../core/media';
import { makeUid, type CommandResult, type DeviceCommand, type JsonObject, type JsonValue, type SmartEntity } from '../../core/types';
import { fetchRegistryInfo, REGISTRY_EVENTS, type EntityRegistryInfo } from './haRegistries';
import { HomeAssistantConnection, type ConnectionState, type HomeAssistantConnectionConfig } from './HomeAssistantConnection';

export type HomeAssistantConfig = HomeAssistantConnectionConfig;

/** App-level action names that HA spells differently (older voice prompts said `set_volume`). */
const SERVICE_ALIASES: Readonly<Record<string, string>> = {
  'media_player.set_volume': 'volume_set',
  'media_player.mute': 'volume_mute',
};

/** HA `target` selector for `call_service`. */
export interface ServiceTarget {
  readonly entity_id?: string | readonly string[];
  readonly device_id?: string | readonly string[];
  readonly area_id?: string | readonly string[];
}

/**
 * Home Assistant provider over the WebSocket API.
 * Flow: auth (Long-Lived Access Token) → get_states → subscribe_events(state_changed).
 * Raw events go to the registry, whose StateThrottler batches them (100ms) before UI state.
 */
export class HomeAssistantProvider extends BaseDeviceProvider {
  readonly id = 'home_assistant';
  readonly displayName = 'Home Assistant';

  private readonly conn: HomeAssistantConnection;
  private stateSubId = -1;
  private readonly registrySubIds = new Set<number>();
  /** Areas and categories from HA's registries, by entity_id. */
  private registry = new Map<string, EntityRegistryInfo>();
  private registryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: HomeAssistantConfig) {
    super();
    this.conn = new HomeAssistantConnection(config, {
      onAuthenticated: () => this.sync(),
      onEvent: (subId, event) => {
        if (subId === this.stateSubId) this.onStateChanged(event);
        else if (this.registrySubIds.has(subId)) this.scheduleRegistryRefresh();
      },
      onStateChange: (state, error) => this.onConnectionState(state, error),
    });
  }

  /**
   * Rejects if the first attempt fails, but keeps retrying with backoff in the
   * background unless the token was rejected or `disconnect()` is called.
   */
  connect(): Promise<void> {
    return this.conn.start();
  }

  async disconnect(): Promise<void> {
    if (this.registryTimer) clearTimeout(this.registryTimer);
    this.conn.stop();
  }

  /** Calls any HA service, e.g. `callService('light', 'turn_on', { brightness: 128 }, { entity_id: 'light.kitchen' })`. */
  async callService(domain: string, service: string, serviceData: JsonObject = {}, target?: ServiceTarget): Promise<JsonValue | undefined> {
    const payload: Record<string, unknown> = { type: 'call_service', domain, service, service_data: serviceData };
    if (target) payload['target'] = target;
    const result = await this.conn.request(payload);
    return isRecord(result) ? toJsonObject(result) : undefined;
  }

  async executeCommand(command: DeviceCommand): Promise<CommandResult> {
    if (command.providerId !== this.id) return commandError('Wrong provider for command');
    const entity = this.entities.get(makeUid(this.id, command.targetId));
    // Services are keyed by the service domain; default to the entity's own domain (e.g. light.turn_on).
    const domain = command.domain || entity?.domain || command.targetId.split('.')[0] || '';
    const service = SERVICE_ALIASES[`${domain}.${command.action}`] ?? command.action;
    try {
      const data = await this.callService(domain, service, command.payload ?? {}, { entity_id: command.targetId });
      const msg = `${domain}.${service} → ${command.targetId}`;
      return data === undefined ? commandOk(msg) : { ok: true, message: msg, data };
    } catch (err: unknown) {
      return commandError(errorMessage(err));
    }
  }

  /** HA `media_player/browse_media`: the player's library root, or a folder within it. */
  async browseMedia(targetId: string, request: BrowseRequest): Promise<MediaItem> {
    const payload: Record<string, unknown> = { type: 'media_player/browse_media', entity_id: targetId };
    if (request.contentId) payload['media_content_id'] = request.contentId;
    if (request.contentType) payload['media_content_type'] = request.contentType;
    const item = parseBrowseMedia(await this.conn.request(payload));
    if (!item) throw new Error('Home Assistant returned an unreadable library');
    return item;
  }

  /** HA `media_player.search_media` (a service that returns results). */
  async searchMedia(targetId: string, request: SearchRequest): Promise<MediaItem[]> {
    const serviceData: Record<string, unknown> = { search_query: request.query };
    if (request.classes?.length) serviceData['media_filter_classes'] = request.classes;
    const res = await this.conn.request({
      type: 'call_service',
      domain: 'media_player',
      service: 'search_media',
      service_data: serviceData,
      target: { entity_id: targetId },
      return_response: true,
    });
    return parseSearchResults(res, targetId);
  }

  /** HA's Google Assistant SDK integration: reaches devices linked to Google Home but not to HA. */
  async askAssistant(command: string): Promise<JsonValue | undefined> {
    const base = { type: 'call_service', domain: 'google_assistant_sdk', service: 'send_text_command', service_data: { command } };
    const res = await this.conn.request({ ...base, return_response: true }).catch((err: unknown) => {
      // Older HA versions don't return the assistant's reply; still send the command.
      if (/response/i.test(errorMessage(err))) return this.conn.request(base);
      throw err;
    });
    return isRecord(res) ? toJsonObject(res) : undefined;
  }

  /** Full resync after every (re)auth: prunes entities deleted while we were offline. */
  private async sync(): Promise<void> {
    this.registry = await this.loadRegistry();
    const states = await this.conn.request({ type: 'get_states' });
    const seen = new Set<string>();
    if (Array.isArray(states)) {
      for (const raw of states) {
        const entity = this.normalize(raw);
        if (!entity) continue;
        seen.add(entity.uid);
        this.upsertEntity(entity);
      }
    }
    for (const uid of [...this.entities.keys()]) if (!seen.has(uid)) this.removeEntity(uid);
    this.stateSubId = await this.conn.subscribe({ type: 'subscribe_events', event_type: 'state_changed' });
    this.registrySubIds.clear();
    for (const event_type of REGISTRY_EVENTS) {
      try {
        this.registrySubIds.add(await this.conn.subscribe({ type: 'subscribe_events', event_type }));
      } catch {
        // Non-admin tokens may not get registry events; areas still load at each reconnect.
      }
    }
  }

  /** Registries are optional extras: on failure the dashboard just has no areas. */
  private async loadRegistry(): Promise<Map<string, EntityRegistryInfo>> {
    try {
      return await fetchRegistryInfo((p) => this.conn.request(p));
    } catch (err: unknown) {
      console.warn(`[home_assistant] couldn't read areas: ${errorMessage(err)}`);
      return new Map();
    }
  }

  /** Areas or categories changed in HA: reload (debounced) and re-label every entity. */
  private scheduleRegistryRefresh(): void {
    if (this.registryTimer) clearTimeout(this.registryTimer);
    this.registryTimer = setTimeout(() => {
      this.registryTimer = null;
      void this.loadRegistry().then((info) => {
        this.registry = info;
        for (const e of [...this.entities.values()]) this.upsertEntity(this.withRegistry(e));
      });
    }, 1000);
  }

  private withRegistry(e: SmartEntity): SmartEntity {
    const info = this.registry.get(e.nativeId);
    const { area: _area, secondary: _secondary, integration: _integration, ...rest } = e;
    if (!info) return rest;
    return {
      ...rest,
      ...(info.area ? { area: info.area } : {}),
      ...(info.secondary ? { secondary: true } : {}),
      ...(info.platform ? { integration: info.platform } : {}),
    };
  }

  private onStateChanged(event: unknown): void {
    if (!isRecord(event) || !isRecord(event['data'])) return;
    const data = event['data'];
    const entityId = str(data['entity_id']);
    if (!entityId) return;
    if (data['new_state'] === null) {
      this.removeEntity(makeUid(this.id, entityId));
      return;
    }
    const entity = this.normalize(data['new_state']);
    if (entity) this.upsertEntity(entity);
  }

  private onConnectionState(state: ConnectionState, error?: string): void {
    switch (state) {
      case 'connecting':
      case 'reconnecting':
        this.setStatus(state);
        break;
      case 'authenticated':
        this.setStatus('connected');
        break;
      case 'auth_failed':
        this.setStatus('error', error ?? 'auth failed');
        break;
      case 'closed':
        this.setStatus('disconnected');
        break;
      case 'idle':
        break;
    }
    // While offline, surface entities as unavailable rather than silently stale.
    if (state === 'reconnecting' || state === 'auth_failed') this.markAllUnavailable();
  }

  private markAllUnavailable(): void {
    for (const e of this.entities.values()) {
      if (e.available) this.upsertEntity({ ...e, available: false, lastUpdated: Date.now() });
    }
  }

  private normalize(raw: unknown): SmartEntity | null {
    if (!isRecord(raw)) return null;
    const entityId = str(raw['entity_id']);
    const dot = entityId.indexOf('.');
    if (dot <= 0) return null;
    const now = Date.now();
    const attributes = toJsonObject(raw['attributes']);
    const state = str(raw['state'], 'unknown');
    const friendly = attributes['friendly_name'];
    return this.withRegistry({
      uid: makeUid(this.id, entityId),
      nativeId: entityId,
      providerId: this.id,
      domain: entityId.slice(0, dot),
      name: typeof friendly === 'string' ? friendly : entityId,
      state,
      attributes,
      lastChanged: parseTime(raw['last_changed'], now),
      lastUpdated: parseTime(raw['last_updated'], now),
      available: state !== 'unavailable',
    });
  }
}
