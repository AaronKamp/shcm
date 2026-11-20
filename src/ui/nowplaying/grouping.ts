import type { DeviceCommand, SmartEntity } from '../../core/types';
import { isDashboardEntity } from '../dashboardEntities';
import { cmd } from '../entityActions';
import { looksMusicAssistant } from '../media/mediaApps';

/** HA MediaPlayerEntityFeature.GROUPING (media_player.join / unjoin). */
const GROUPING_FEATURE = 1 << 19;

const members = (e: SmartEntity): string[] => {
  const v = e.attributes['group_members'];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
};

const canJoin = (e: SmartEntity): boolean => {
  const bits = e.attributes['supported_features'];
  return typeof bits !== 'number' || (bits & GROUPING_FEATURE) !== 0;
};

/** Speakers the card can control: dashboard media players, minus account-level players like Spotify's. */
export const speakerCandidates = (entities: readonly SmartEntity[]): SmartEntity[] =>
  entities
    .filter((e) => e.domain === 'media_player' && isDashboardEntity(e) && e.integration !== 'spotify' && !/spotify/i.test(e.nativeId))
    .sort((a, b) => Number(looksMusicAssistant(b)) - Number(looksMusicAssistant(a)) || a.name.localeCompare(b.name));

/** With nothing chosen: what's playing (Music Assistant first), else the first Music Assistant speaker. */
export const autoSpeaker = (candidates: readonly SmartEntity[]): SmartEntity | undefined =>
  candidates.find((e) => e.state === 'playing' && looksMusicAssistant(e)) ??
  candidates.find((e) => e.state === 'playing') ??
  candidates.find(looksMusicAssistant) ??
  candidates[0];

/**
 * How several chosen speakers play together:
 * - `group`: an existing group player (a Music Assistant or Google Home group) has exactly these members;
 * - `joined`: the first speaker already leads the others;
 * - `joinable`: the first speaker supports grouping, so it can be told to lead the others;
 * - `unsupported`: no way to sync them from here.
 * `player` is where playback commands go.
 */
export type GroupPlan =
  | { readonly kind: 'single'; readonly player: SmartEntity }
  | { readonly kind: 'group' | 'joined'; readonly player: SmartEntity; readonly others: readonly SmartEntity[] }
  | { readonly kind: 'joinable' | 'unsupported'; readonly player: SmartEntity; readonly others: readonly SmartEntity[] };

export const planGroup = (chosen: readonly SmartEntity[], all: readonly SmartEntity[]): GroupPlan | undefined => {
  const [leader, ...others] = chosen;
  if (!leader) return undefined;
  if (others.length === 0) return { kind: 'single', player: leader };
  const wanted = new Set(chosen.map((e) => e.nativeId));
  const groupPlayer = all.find((p) => {
    const m = members(p).filter((id) => id !== p.nativeId);
    return !wanted.has(p.nativeId) && p.providerId === leader.providerId && m.length === wanted.size && m.every((id) => wanted.has(id));
  });
  if (groupPlayer) return { kind: 'group', player: groupPlayer, others: chosen };
  const led = new Set(members(leader));
  if (others.every((o) => led.has(o.nativeId))) return { kind: 'joined', player: leader, others };
  const sameProvider = others.every((o) => o.providerId === leader.providerId);
  return { kind: sameProvider && canJoin(leader) ? 'joinable' : 'unsupported', player: leader, others };
};

/** `media_player.join`: the leader plays and the others follow in sync. */
export const joinCommands = (leader: SmartEntity, others: readonly SmartEntity[]): DeviceCommand[] => [
  cmd(leader, 'join', { group_members: others.map((o) => o.nativeId) }),
];

/** `media_player.unjoin` for each follower. */
export const unjoinCommands = (others: readonly SmartEntity[]): DeviceCommand[] => others.map((o) => cmd(o, 'unjoin'));
