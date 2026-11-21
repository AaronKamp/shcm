import type { JsonObject, JsonValue, ProviderId, SmartEntity } from '../core/types';

/** Lines Gemini gets; large homes have hundreds of sensors, so the useful ones go first. */
const MAX_DEVICES = 350;

/** Things people control by voice, in rough order of how often. */
const CONTROL_DOMAINS = ['light', 'switch', 'media_player', 'lock', 'cover', 'climate', 'fan', 'vacuum', 'alarm_control_panel', 'remote', 'scene', 'script', 'webhook'];
/** Read-only but worth asking about ("is the garage open?", "what's the temperature?"). */
const STATUS_DOMAINS = ['binary_sensor', 'sensor', 'weather'];
/** Never useful by voice. */
const SKIP_DOMAINS = new Set(['notify', 'update', 'stt', 'tts', 'conversation', 'event', 'zone', 'sun', 'todo', 'device_tracker', 'person', 'button', 'number', 'select', 'automation', 'camera']);

/** How people refer to a device of this integration ("the Denon", "the receiver"). */
const KIND: Readonly<Record<string, string>> = {
  denonavr: 'Denon AV receiver (power, volume, input, sound mode)',
  samsungtv: 'Samsung TV',
  cast: 'Google Cast speaker/TV',
  alexa_devices: 'Amazon Echo / Alexa',
  music_assistant: 'Music Assistant player (for playing music)',
  spotify: 'Spotify',
  plex: 'Plex player',
  unifiprotect: 'UniFi camera speaker',
  audiconnect: 'the electric car (Audi e-tron)',
  chargepoint: 'the home EV charger (ChargePoint)',
};

const strings = (v: JsonValue | undefined): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Source / sound-mode lists so Gemini can pick a valid select_source value. */
const mediaDetails = (a: JsonObject): string => {
  const parts: string[] = [];
  if (typeof a['source'] === 'string') parts.push(`source ${a['source']}`);
  const sources = strings(a['source_list']);
  if (sources.length) parts.push(`sources: ${sources.join(', ')}`);
  const modes = strings(a['sound_mode_list']);
  if (modes.length) parts.push(`sound modes: ${modes.join(', ')}`);
  return parts.length ? ` (${parts.join('; ')})` : '';
};

/** "DENON:[AVR-3312CI]" → "DENON AVR-3312CI", so it reads like something a person would say. */
const speakable = (name: string): string => name.replace(/[[\]:_]+/g, ' ').replace(/\s+/g, ' ').trim();

const rank = (e: SmartEntity): number => {
  const control = CONTROL_DOMAINS.indexOf(e.domain);
  if (control >= 0) return control;
  const status = STATUS_DOMAINS.indexOf(e.domain);
  return status >= 0 ? 100 + status : 200;
};

const toolProvider = (id: ProviderId): string => (id === 'custom_hook' ? 'custom_hook' : 'home_assistant');

/**
 * The device lines of the system instruction: controllable devices first,
 * then sensors; config/diagnostic entities and voice-useless domains left
 * out. Names are what the dashboard shows (the user's renames), with the
 * backend name and the device's kind as aliases.
 */
export const deviceLines = (all: Iterable<SmartEntity>, renames: Readonly<Record<string, string>>): string[] => {
  const picked = [...all]
    .filter((e) => !SKIP_DOMAINS.has(e.domain) && !e.secondary)
    .sort((a, b) => rank(a) - rank(b) || (a.area ?? '').localeCompare(b.area ?? '') || a.name.localeCompare(b.name))
    .slice(0, MAX_DEVICES);
  return picked.map((e) => {
    const shown = renames[e.uid] ?? speakable(e.name);
    const aliases = [e.name !== shown ? speakable(e.name) : '', e.integration ? (KIND[e.integration] ?? '') : ''].filter((s) => s && s !== shown);
    const aka = aliases.length ? ` aka ${aliases.map((s) => `"${s}"`).join(', ')}` : '';
    const area = e.area ? ` (${e.area})` : '';
    const avail = e.available ? '' : ' UNAVAILABLE';
    return `- ${e.nativeId} [${toolProvider(e.providerId)}] "${shown}"${aka}${area}: ${e.state}${avail}${e.domain === 'media_player' ? mediaDetails(e.attributes) : ''}`;
  });
};
