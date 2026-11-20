import { num } from '../../core/json';
import type { JsonObject } from '../../core/types';
import { mockNowPlaying } from './mockLibrary';

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const listHas = (list: JsonObject[string] | undefined, value: string): boolean => Array.isArray(list) && list.includes(value);

/**
 * Mirrors HA's media_player services on `attrs` (mutated). Returns true if
 * handled, false if not a media action, or an error message.
 */
export const applyMediaAction = (action: string, payload: JsonObject, attrs: JsonObject): boolean | string => {
  const vol = num(attrs['volume_level']) ?? 0.5;
  switch (action) {
    case 'volume_set':
    case 'set_volume': {
      const v = num(payload['volume_level']) ?? num(payload['volume']);
      if (v === undefined) return `${action} requires payload.volume_level (0-1)`;
      attrs['volume_level'] = clamp(v, 0, 1);
      return true;
    }
    case 'volume_up':
    case 'volume_down':
      attrs['volume_level'] = clamp(Math.round((vol + (action === 'volume_up' ? 0.05 : -0.05)) * 100) / 100, 0, 1);
      return true;
    case 'volume_mute': {
      const m = payload['is_volume_muted'];
      if (typeof m !== 'boolean') return 'volume_mute requires payload.is_volume_muted (true/false)';
      attrs['is_volume_muted'] = m;
      return true;
    }
    case 'select_source': {
      const s = payload['source'];
      if (typeof s !== 'string' || !listHas(attrs['source_list'], s)) return `Unknown source "${String(s)}"`;
      attrs['source'] = s;
      return true;
    }
    case 'play_media': {
      const playing = mockNowPlaying(typeof payload['media_content_id'] === 'string' ? payload['media_content_id'] : '');
      if (!playing) return 'play_media requires a media_content_id from the library';
      attrs['media_title'] = playing.title;
      attrs['media_artist'] = playing.artist;
      return true;
    }
    case 'join': {
      const others = payload['group_members'];
      if (!Array.isArray(others) || others.some((o) => typeof o !== 'string')) return 'join requires payload.group_members (entity ids)';
      attrs['group_members'] = others;
      return true;
    }
    case 'unjoin':
      attrs['group_members'] = [];
      return true;
    case 'media_next_track':
    case 'media_previous_track':
      return true;
    case 'select_sound_mode': {
      const s = payload['sound_mode'];
      if (typeof s !== 'string' || !listHas(attrs['sound_mode_list'], s)) return `Unknown sound mode "${String(s)}"`;
      attrs['sound_mode'] = s;
      return true;
    }
    default:
      return false;
  }
};
