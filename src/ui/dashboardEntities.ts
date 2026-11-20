import type { SmartEntity } from '../core/types';

/**
 * Domains the dashboard can show as cards. Home Assistant also exposes
 * services and plumbing (notify, event, update, stt, tts, zone, sun…), which
 * would bury the real devices.
 */
const DASHBOARD_DOMAINS: ReadonlySet<string> = new Set([
  'light',
  'switch',
  'lock',
  'climate',
  'media_player',
  'vacuum',
  'cover',
  'fan',
  'sensor',
  'binary_sensor',
  'webhook',
]);

/** True for entities that belong on the dashboard and overlay pickers. */
export const isDashboardEntity = (e: SmartEntity): boolean => DASHBOARD_DOMAINS.has(e.domain) && !e.secondary;
