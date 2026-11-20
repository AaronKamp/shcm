import type { MediaItem } from '../../core/media';
import type { DeviceCommand, SmartEntity } from '../../core/types';
import type { MediaApps } from '../../state/mediaAppStore';
import { cmd } from '../entityActions';

export type AppKind = 'spotify' | 'music_assistant';

export interface LinkedApp {
  readonly kind: AppKind;
  readonly label: string;
  /** The HA player that controls playback for this app on this speaker. */
  readonly player: SmartEntity;
  /** Playing or paused on this speaker right now. */
  readonly active: boolean;
  readonly playing: boolean;
}

/** HA MediaPlayerEntityFeature bits for transport. */
const FEATURE = { PAUSE: 1, PREVIOUS_TRACK: 16, NEXT_TRACK: 32, PLAY: 16384 } as const;

export const isPlaying = (e: SmartEntity): boolean => e.state === 'playing';
const isLoaded = (e: SmartEntity): boolean => e.state === 'playing' || e.state === 'paused' || e.state === 'buffering';

/** Music Assistant players carry `mass_*` attributes. */
export const looksMusicAssistant = (e: SmartEntity): boolean => Object.keys(e.attributes).some((k) => k.startsWith('mass_'));

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Links used until the user saves their own: a Music Assistant player is its
 * own Music Assistant app; any other speaker uses the one Music Assistant
 * player with the same name (e.g. the Denon card → MA's "DENON:[AVR-3312CI]").
 */
export const defaultLinks = (speaker: SmartEntity, players: readonly SmartEntity[]): MediaApps | undefined => {
  if (speaker.domain !== 'media_player') return undefined;
  if (looksMusicAssistant(speaker)) return { musicAssistant: { playerUid: speaker.uid } };
  const n = norm(speaker.name);
  const same = players.filter((p) => p.uid !== speaker.uid && looksMusicAssistant(p) && norm(p.name) === n);
  return same.length === 1 && same[0] ? { musicAssistant: { playerUid: same[0].uid } } : undefined;
};

const VOLUME_SET = 4;
const label = (e: SmartEntity): string => {
  const f = e.attributes['friendly_name'];
  return norm(typeof f === 'string' && f ? f : e.name);
};

/**
 * The device's own player for a Music Assistant player, e.g. the Denon
 * integration's entity behind MA's "DENON:[AVR-3312CI]". Music Assistant may
 * scale the stream in software instead of moving the receiver's volume, so
 * volume goes to the device's own integration when there is one: same name,
 * not a Music Assistant player, reporting and able to set volume. Same area wins ties.
 */
export const hardwarePlayer = (speaker: SmartEntity, players: readonly SmartEntity[]): SmartEntity | undefined => {
  if (!looksMusicAssistant(speaker)) return undefined;
  const n = label(speaker);
  const twins = players.filter((p) => {
    if (p.uid === speaker.uid || p.domain !== 'media_player' || looksMusicAssistant(p) || label(p) !== n) return false;
    // It must report its volume now (a Cast device that's "off" doesn't), so the slider shows the real level.
    const bits = p.attributes['supported_features'];
    return p.available && typeof p.attributes['volume_level'] === 'number' && (typeof bits !== 'number' || (bits & VOLUME_SET) !== 0);
  });
  return twins.find((p) => p.area === speaker.area) ?? twins[0];
};

/** Resolves a speaker's linked apps against live entities; missing players are skipped. */
export const resolveApps = (links: MediaApps | undefined, byUid: ReadonlyMap<string, SmartEntity>): LinkedApp[] => {
  const apps: LinkedApp[] = [];
  const spotify = links?.spotify ? byUid.get(links.spotify.playerUid) : undefined;
  if (links?.spotify && spotify) {
    const here = spotify.attributes['source'] === links.spotify.device;
    apps.push({ kind: 'spotify', label: 'Spotify', player: spotify, active: here && isLoaded(spotify), playing: here && isPlaying(spotify) });
  }
  const ma = links?.musicAssistant ? byUid.get(links.musicAssistant.playerUid) : undefined;
  if (ma) apps.push({ kind: 'music_assistant', label: 'Music Assistant', player: ma, active: isLoaded(ma), playing: isPlaying(ma) });
  return apps;
};

/** The app in charge: the one playing, else the one paused, else none (the speaker itself). */
export const activeApp = (apps: readonly LinkedApp[]): LinkedApp | undefined => apps.find((a) => a.playing) ?? apps.find((a) => a.active);

/** Which transport buttons the player supports (all, when it doesn't say). */
export const transportCaps = (e: SmartEntity) => {
  const bits = typeof e.attributes['supported_features'] === 'number' ? e.attributes['supported_features'] : null;
  const has = (bit: number): boolean => bits === null || (bits & bit) !== 0;
  return { playPause: has(FEATURE.PLAY) || has(FEATURE.PAUSE), previous: has(FEATURE.PREVIOUS_TRACK), next: has(FEATURE.NEXT_TRACK) };
};

/** "Title — Artist", or null when nothing is loaded. */
export const nowPlaying = (e: SmartEntity): string | null => {
  if (!isLoaded(e)) return null;
  const title = e.attributes['media_title'];
  const artist = e.attributes['media_artist'] ?? e.attributes['media_album_artist'];
  if (typeof title !== 'string' || !title) return null;
  return typeof artist === 'string' && artist ? `${title} — ${artist}` : title;
};

/**
 * Commands to move playback on `speaker` to `target`, in order: wake the
 * speaker if it's off, pause whichever other app is playing here, then start
 * the target (Spotify: transfer to this speaker's Connect device first).
 */
export const switchCommands = (speaker: SmartEntity, apps: readonly LinkedApp[], target: LinkedApp, links: MediaApps): DeviceCommand[] => {
  const out: DeviceCommand[] = [];
  if (speaker.state === 'off' || speaker.state === 'standby') out.push(cmd(speaker, 'turn_on'));
  for (const a of apps) if (a !== target && a.playing) out.push(cmd(a.player, 'media_pause'));
  if (target.kind === 'spotify' && links.spotify) out.push(cmd(target.player, 'select_source', { source: links.spotify.device }));
  out.push(cmd(target.player, 'media_play'));
  return out;
};

/**
 * Commands to play a library item from `app` on `speaker`: same preparation
 * as switching (wake, pause the other app, move Spotify here if needed), then
 * `play_media` instead of resuming.
 */
export const playItemCommands = (speaker: SmartEntity, apps: readonly LinkedApp[], app: LinkedApp | undefined, links: MediaApps | undefined, item: MediaItem): DeviceCommand[] => {
  const media = { media_content_id: item.contentId, media_content_type: item.contentType };
  if (!app || !links) return [cmd(speaker, 'play_media', media)];
  const out = switchCommands(speaker, apps, app, links).slice(0, -1);
  if (app.kind === 'spotify' && app.player.attributes['source'] === links.spotify?.device) {
    // Already on this speaker: no need to transfer again.
    const transfer = out.findIndex((c) => c.action === 'select_source');
    if (transfer >= 0) out.splice(transfer, 1);
  }
  out.push(cmd(app.player, 'play_media', media));
  return out;
};
