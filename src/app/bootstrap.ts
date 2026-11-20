import { createProviderRegistry, type RegistryConfig } from '../core/createRegistry';
import type { ProviderRegistry } from '../core/ProviderRegistry';
import { getHomeAssistantRelayUrl, hasSecret, unifiTransport } from '../platform/secrets';
import { unifiStreamBridge } from '../platform/videoBridge';
import { inTauri } from '../platform/window';
import { bindRegistry, useDeviceStore } from '../state/deviceStore';

const env = (name: string): string | undefined => {
  const v: unknown = import.meta.env[name];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};

/**
 * Live providers run only in the desktop app, and only for integrations whose
 * URL + credential are in the OS credential store. Credentials never enter JS:
 * HA connects through the Rust relay, UniFi through the `unifi_request` command.
 * UniFi video plays via go2rtc (`go2rtc_url` entry) through the Rust video bridge.
 * `VITE_SHCM_MOCK=1` forces mock mode; `VITE_SHCM_GO2RTC` adds WHEP streams to mock cameras.
 */
const liveConfig = async (): Promise<RegistryConfig | null> => {
  if (!inTauri() || env('VITE_SHCM_MOCK') === '1') return null;
  const [haUrl, haToken, unifiUrl, unifiKey] = await Promise.all([
    hasSecret('home_assistant_url'),
    hasSecret('home_assistant_token'),
    hasSecret('unifi_url'),
    hasSecret('unifi_api_key'),
  ]);
  const ha = haUrl && haToken;
  const unifi = unifiUrl && unifiKey;
  if (!ha && !unifi) return null;
  return {
    throttleMs: 100,
    ...(ha ? { homeAssistant: { relay: getHomeAssistantRelayUrl } } : {}),
    // The bridge reports "go2rtc URL not set" per camera; cameras still list without it.
    ...(unifi ? { unifiProtect: { transport: unifiTransport, streamBridge: unifiStreamBridge } } : {}),
  };
};

const mockConfig = (): RegistryConfig => {
  const go2rtcUrl = env('VITE_SHCM_GO2RTC');
  return { throttleMs: 100, mock: go2rtcUrl ? { tickMs: 2000, go2rtcUrl } : { tickMs: 2000 } };
};

let registry: Promise<ProviderRegistry> | null = null;
let unbind: (() => void) | null = null;

const create = async (): Promise<ProviderRegistry> => {
  const live = await liveConfig().catch((err: unknown) => {
    console.warn('[shcm] credential store unavailable, using mock providers', err);
    return null;
  });
  useDeviceStore.setState({ mock: live === null, ready: false });
  const reg = createProviderRegistry(live ?? mockConfig());
  // Binding replays an empty snapshot, which clears the previous registry's devices from the UI.
  unbind = bindRegistry(reg);
  const results = await reg.connectAll();
  for (const [id, err] of results) if (err) console.warn(`[shcm] provider ${id} failed to connect: ${err}`);  return reg;
};

export const startRegistry = (): Promise<ProviderRegistry> => (registry ??= create());

/**
 * Tears down every provider and rebuilds from the credential store (e.g. after
 * `credentials-updated`). Calls are chained, so overlapping restarts never run
 * two registries at once; `startRegistry()` callers get the new one.
 */
export const restartRegistry = (): Promise<ProviderRegistry> => {
  const previous = registry;
  registry = (async () => {
    const old = await previous?.catch(() => null);
    unbind?.();
    unbind = null;
    await old?.dispose();
    return create();
  })();
  return registry;
};
