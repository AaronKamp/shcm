import { listen } from '@tauri-apps/api/event';
import { errorMessage } from '../core/DeviceProvider';
import {
  CREDENTIALS_UPDATED_EVENT,
  hasSecret,
  isSecretKind,
  type SecretKind,
} from '../platform/secrets';
import { inTauri } from '../platform/window';
import { isRecord } from '../core/json';
import { setVoice } from '../state/voiceStore';
import { restartRegistry } from './bootstrap';
import { getVoiceSession } from './voice';

/** Entries that feed the device registry (HA relay / UniFi command). */
const REGISTRY_KINDS: ReadonlySet<SecretKind> = new Set<SecretKind>([
  'home_assistant_url',
  'home_assistant_token',
  'unifi_url',
  'unifi_api_key',
  'unifi_username',
  'unifi_password',
  'go2rtc_url', // UniFi re-registers its streams with the new go2rtc on rebuild
]);

const parseKinds = (payload: unknown): SecretKind[] =>
  isRecord(payload) && Array.isArray(payload['kinds']) ? payload['kinds'].filter(isSecretKind) : [];

const applyUpdate = async (kinds: readonly SecretKind[]): Promise<void> => {
  const tasks: Promise<unknown>[] = [];
  if (kinds.some((k) => REGISTRY_KINDS.has(k))) {
    // Rebuild providers so HA/UniFi switch on, off, or onto new credentials right away.
    tasks.push(restartRegistry());
  }
  if (kinds.includes('gemini_api_key')) {
    tasks.push(
      (async () => {
        const has = await hasSecret('gemini_api_key');
        setVoice({ needsKey: !has, ...(has ? { error: null } : {}) });
        // The relay reads the key per connection: drop the live socket so the next talk uses the new key.
        await getVoiceSession()?.shutdown(false);
      })(),
    );
  }
  const results = await Promise.allSettled(tasks);
  for (const r of results) if (r.status === 'rejected') console.warn('[shcm] reconnect failed', errorMessage(r.reason));
};

/**
 * Every window (dashboard + overlay) runs this. `emit()` reaches the emitting
 * window too, so the window that saved credentials reconnects via the same path.
 */
export const installCredentialSync = async (): Promise<() => void> => {
  if (!inTauri()) return () => undefined;
  return listen<unknown>(CREDENTIALS_UPDATED_EVENT, (e) => {
    const kinds = parseKinds(e.payload);
    if (kinds.length) void applyUpdate(kinds);
  });
};
