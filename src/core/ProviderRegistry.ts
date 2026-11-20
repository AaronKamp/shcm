import { commandError, errorMessage, type DeviceProvider } from './DeviceProvider';
import { StateThrottler } from './StateThrottler';
import type { BrowseRequest, MediaItem, SearchRequest } from './media';
import type {
  CameraStream,
  CommandResult,
  DeviceCommand,
  JsonValue,
  ProviderEvent,
  ProviderId,
  ProviderStatus,
  SmartEntity,
  Unsubscribe,
} from './types';

/** Normalized, throttled snapshot handed to state stores (Zustand later). */
export interface RegistrySnapshot {
  readonly entities: ReadonlyMap<string, SmartEntity>;
  readonly cameras: ReadonlyMap<string, CameraStream>;
  readonly statuses: ReadonlyMap<ProviderId, ProviderStatus>;
}

export type RegistryListener = (snapshot: RegistrySnapshot, batch: readonly ProviderEvent[]) => void;

export interface ProviderRegistryOptions {
  /** Throttle window for UI-bound updates, in ms. Default 100. */
  readonly throttleMs?: number;
}

/**
 * Single entry point for every integration. Owns provider lifecycles,
 * merges their event streams, throttles them, and routes commands
 * (including Gemini `toolCall`s) to the right provider.
 */
export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, DeviceProvider>();
  private readonly providerSubs = new Map<ProviderId, Unsubscribe>();
  private readonly listeners = new Set<RegistryListener>();
  private readonly entities = new Map<string, SmartEntity>();
  private readonly cameras = new Map<string, CameraStream>();
  private readonly statuses = new Map<ProviderId, ProviderStatus>();
  private readonly throttler: StateThrottler;

  constructor(options: ProviderRegistryOptions = {}) {
    this.throttler = new StateThrottler((batch) => this.applyBatch(batch), options.throttleMs ?? 100);
  }

  register(provider: DeviceProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider "${provider.id}" is already registered`);
    }
    this.providers.set(provider.id, provider);
    this.statuses.set(provider.id, provider.status);
    this.providerSubs.set(provider.id, provider.subscribeStates((event) => this.throttler.push(event)));
  }

  async unregister(id: ProviderId): Promise<void> {
    const provider = this.providers.get(id);
    if (!provider) return;
    await provider.disconnect();
    this.providerSubs.get(id)?.();
    this.providerSubs.delete(id);
    this.providers.delete(id);
    this.throttler.drain();
    for (const [uid, e] of this.entities) if (e.providerId === id) this.entities.delete(uid);
    for (const [uid, c] of this.cameras) if (c.providerId === id) this.cameras.delete(uid);
    this.statuses.delete(id);
    this.notify([]);
  }

  get(id: ProviderId): DeviceProvider | undefined {
    return this.providers.get(id);
  }

  list(): readonly DeviceProvider[] {
    return [...this.providers.values()];
  }

  /** Connects all providers in parallel; one failing provider never blocks the rest. */
  async connectAll(): Promise<ReadonlyMap<ProviderId, string | null>> {
    const results = new Map<ProviderId, string | null>();
    await Promise.all(
      this.list().map(async (p) => {
        try {
          await p.connect();
          results.set(p.id, null);
        } catch (err: unknown) {
          results.set(p.id, errorMessage(err));
        }
      }),
    );
    return results;
  }

  async disconnectAll(): Promise<void> {
    await Promise.allSettled(this.list().map((p) => p.disconnect()));
    this.throttler.drain();
  }

  async executeCommand(command: DeviceCommand): Promise<CommandResult> {
    const provider = this.providers.get(command.providerId);
    if (!provider) return commandError(`Unknown provider "${command.providerId}"`);
    if (provider.status !== 'connected') {
      return commandError(`Provider "${command.providerId}" is ${provider.status}`);
    }
    try {
      return await provider.executeCommand(command);
    } catch (err: unknown) {
      return commandError(errorMessage(err));
    }
  }

  /** Browses a media player's library; rejects if its provider can't browse. */
  async browseMedia(player: SmartEntity, request: BrowseRequest): Promise<MediaItem> {
    const provider = this.providers.get(player.providerId);
    if (!provider?.browseMedia) throw new Error(`${player.name} doesn't offer a library`);
    if (provider.status !== 'connected') throw new Error(`Provider "${player.providerId}" is ${provider.status}`);
    return provider.browseMedia(player.nativeId, request);
  }

  /** Searches a media player's library; rejects if its provider can't search. */
  async searchMedia(player: SmartEntity, request: SearchRequest): Promise<MediaItem[]> {
    const provider = this.providers.get(player.providerId);
    if (!provider?.searchMedia) throw new Error(`${player.name} can't search its library`);
    if (provider.status !== 'connected') throw new Error(`Provider "${player.providerId}" is ${provider.status}`);
    return provider.searchMedia(player.nativeId, request);
  }

  /** Sends a typed command to the first connected provider that links an outside assistant (Google Home). */
  askAssistant(command: string): Promise<JsonValue | undefined> {
    const provider = [...this.providers.values()].find((p) => p.askAssistant && p.status === 'connected');
    if (!provider?.askAssistant) return Promise.reject(new Error('No connected provider can reach Google Home'));
    return provider.askAssistant(command);
  }

  /** Subscribe to throttled, merged state. Fires immediately with the current snapshot. */
  subscribe(listener: RegistryListener): Unsubscribe {
    this.listeners.add(listener);
    listener(this.snapshot(), []);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): RegistrySnapshot {
    return { entities: new Map(this.entities), cameras: new Map(this.cameras), statuses: new Map(this.statuses) };
  }

  /** Voice lookup: match a camera by uid, native id, slug or name (case-insensitive). */
  findCamera(query: string): CameraStream | undefined {
    const q = query.trim().toLowerCase().replace(/\s+/g, '_');
    for (const c of this.cameras.values()) {
      if (c.uid === query || c.nativeId === query || c.slug === q || c.name.toLowerCase().replace(/\s+/g, '_') === q) {
        return c;
      }
    }
    return undefined;
  }

  async dispose(): Promise<void> {
    await this.disconnectAll();
    for (const unsub of this.providerSubs.values()) unsub();
    this.providerSubs.clear();
    this.throttler.dispose();
    this.listeners.clear();
  }

  private applyBatch(batch: readonly ProviderEvent[]): void {
    for (const event of batch) {
      switch (event.type) {
        case 'entity_upsert':
          this.entities.set(event.entity.uid, event.entity);
          break;
        case 'entity_removed':
          this.entities.delete(event.uid);
          break;
        case 'camera_upsert':
          this.cameras.set(event.camera.uid, event.camera);
          break;
        case 'camera_removed':
          this.cameras.delete(event.uid);
          break;
        case 'status':
          this.statuses.set(event.providerId, event.status);
          break;
      }
    }
    this.notify(batch);
  }

  private notify(batch: readonly ProviderEvent[]): void {
    const snap = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(snap, batch);
      } catch (err: unknown) {
        console.error('[registry] listener threw', err);
      }
    }
  }
}
