import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import type { UnifiTransport } from '../providers/UnifiProtectProvider';
import { inTauri } from './window';

/**
 * Entries in the OS credential store managed by src-tauri/src/secrets.rs.
 * Deliberately write-only: there is no command to read a value back into JS.
 * Saving a new `*_url` wipes that service's token/key (and UniFi cert pin), so
 * save the URL first, then the credential. Must match `SecretKind` in secrets.rs.
 */
export type SecretKind =
  | 'gemini_api_key'
  | 'home_assistant_url'
  | 'home_assistant_token'
  | 'unifi_url'
  | 'unifi_api_key'
  | 'unifi_username'
  | 'unifi_password'
  | 'go2rtc_url';

/** Broadcast to every window after credentials change. Payload names kinds only, never values. */
export const CREDENTIALS_UPDATED_EVENT = 'credentials-updated';

export interface CredentialsUpdatedPayload {
  readonly kinds: readonly SecretKind[];
}

const SECRET_KINDS: ReadonlySet<string> = new Set<SecretKind>([
  'gemini_api_key',
  'home_assistant_url',
  'home_assistant_token',
  'unifi_url',
  'unifi_api_key',
  'unifi_username',
  'unifi_password',
  'go2rtc_url',
]);

export const isSecretKind = (v: unknown): v is SecretKind => typeof v === 'string' && SECRET_KINDS.has(v);

/** Tells all windows (including this one) to reconnect whatever depends on `kinds`. */
export const emitCredentialsUpdated = async (kinds: readonly SecretKind[]): Promise<void> => {
  if (!inTauri() || kinds.length === 0) return;
  const payload: CredentialsUpdatedPayload = { kinds };
  await emit(CREDENTIALS_UPDATED_EVENT, payload);
};

/** Saves an entry; an empty string deletes it. */
export const setSecret = (kind: SecretKind, value: string): Promise<void> => {
  if (!inTauri()) return Promise.reject(new Error('Secrets require the desktop app'));
  return invoke<void>('set_secret', { kind, value });
};

export const hasSecret = async (kind: SecretKind): Promise<boolean> =>
  inTauri() ? invoke<boolean>('has_secret', { kind }) : false;

/** `ws://127.0.0.1:<port>/<token>/gemini` — Gemini Live relay. */
export const getGeminiProxyUrl = (): Promise<string> => invoke<string>('get_gemini_proxy_url');

/** `ws://127.0.0.1:<port>/<token>/ha` — pre-authenticated Home Assistant socket. */
export const getHomeAssistantRelayUrl = (): Promise<string> => invoke<string>('get_home_assistant_relay_url');

/** UniFi Protect Integration API via Rust (key + certificate pin never leave the backend). */
export const unifiTransport: UnifiTransport = (method, path, body) =>
  invoke<unknown>('unifi_request', body === undefined ? { method, path } : { method, path, body });
