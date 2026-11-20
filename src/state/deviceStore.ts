import { create } from 'zustand';
import type { ProviderRegistry } from '../core/ProviderRegistry';
import type { BrowseRequest, MediaItem, SearchRequest } from '../core/media';
import type { CameraStream, CommandResult, DeviceCommand, ProviderId, ProviderStatus, SmartEntity } from '../core/types';

interface DeviceStoreState {
  /** Arrays are replaced once per throttled registry batch, so selectors stay referentially stable. */
  readonly entities: readonly SmartEntity[];
  readonly cameras: readonly CameraStream[];
  readonly statuses: Readonly<Partial<Record<ProviderId, ProviderStatus>>>;
  readonly ready: boolean;
  /** True when running MockDeviceProvider (no live integrations configured). */
  readonly mock: boolean;
}

export const useDeviceStore = create<DeviceStoreState>()(() => ({
  entities: [],
  cameras: [],
  statuses: {},
  ready: false,
  mock: true,
}));

let boundRegistry: ProviderRegistry | null = null;

/**
 * Pipes the registry's throttled snapshots into the store. The registry already
 * coalesces provider floods (100ms), so this runs at most ~10x/sec.
 */
export const bindRegistry = (registry: ProviderRegistry): (() => void) => {
  boundRegistry = registry;
  const unsubscribe = registry.subscribe((snap) => {
    const entities = [...snap.entities.values()].sort((a, b) => a.name.localeCompare(b.name));
    const cameras = [...snap.cameras.values()].sort((a, b) => a.name.localeCompare(b.name));
    useDeviceStore.setState({
      entities,
      cameras,
      statuses: Object.fromEntries(snap.statuses),
      ready: [...snap.statuses.values()].some((s) => s === 'connected'),
    });
  });
  return () => {
    unsubscribe();
    if (boundRegistry === registry) boundRegistry = null;
  };
};

/** UI-facing command entry point; everything routes through the registry. */
export const runCommand = async (command: DeviceCommand): Promise<CommandResult> => {
  if (!boundRegistry) return { ok: false, message: 'Registry not ready' };
  return boundRegistry.executeCommand(command);
};

/** Browses a media player's library through its provider. */
export const browseMedia = (player: SmartEntity, request: BrowseRequest = {}): Promise<MediaItem> =>
  boundRegistry ? boundRegistry.browseMedia(player, request) : Promise.reject(new Error('Registry not ready'));

/** Searches a media player's library through its provider. */
export const searchMedia = (player: SmartEntity, request: SearchRequest): Promise<MediaItem[]> =>
  boundRegistry ? boundRegistry.searchMedia(player, request) : Promise.reject(new Error('Registry not ready'));

export const findCamera = (query: string): CameraStream | undefined => boundRegistry?.findCamera(query);
