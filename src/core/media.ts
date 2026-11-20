import { isRecord, str } from './json';

/** One node of a media library (HA's BrowseMedia shape, camel-cased). */
export interface MediaItem {
  readonly title: string;
  /** e.g. playlist, album, artist, track, directory, podcast. */
  readonly mediaClass: string;
  readonly contentId: string;
  readonly contentType: string;
  readonly canPlay: boolean;
  readonly canExpand: boolean;
  /** Artwork: absolute http(s) URL, or an HA-relative `/api/…` path (see `HaImage`). */
  readonly thumbnail?: string;
  readonly children?: readonly MediaItem[];
}

/** Where to browse; empty = the player's library root. */
export interface BrowseRequest {
  readonly contentId?: string;
  readonly contentType?: string;
}

/** A library search; `classes` limits results, e.g. ['artist']. */
export interface SearchRequest {
  readonly query: string;
  readonly classes?: readonly string[];
}

/** HA MediaPlayerEntityFeature.SEARCH_MEDIA. */
export const SEARCH_MEDIA_FEATURE = 1 << 22;

/** Absolute http(s) URLs, or HA-relative `/api/…` paths (loaded through the app's backend). */
const imageUrl = (v: unknown): string | undefined => {
  const s = str(v);
  return /^https?:\/\//i.test(s) || s.startsWith('/api/') ? s : undefined;
};

/** Parses HA's `media_player/browse_media` result. Malformed children are dropped. */
export const parseBrowseMedia = (v: unknown, depth = 0): MediaItem | null => {
  if (!isRecord(v)) return null;
  const children = depth === 0 && Array.isArray(v['children']) ? v['children'].map((c) => parseBrowseMedia(c, 1)).filter((c): c is MediaItem => c !== null) : undefined;
  const thumbnail = imageUrl(v['thumbnail']);
  return {
    title: str(v['title'], 'Untitled'),
    mediaClass: str(v['media_class'], 'directory'),
    contentId: str(v['media_content_id']),
    contentType: str(v['media_content_type']),
    canPlay: v['can_play'] === true,
    canExpand: v['can_expand'] === true,
    ...(thumbnail ? { thumbnail } : {}),
    ...(children ? { children } : {}),
  };
};

/**
 * Parses a `media_player.search_media` service response:
 * `{ response: { <entity_id>: { result: BrowseMedia[] } } }`.
 */
export const parseSearchResults = (v: unknown, entityId: string): MediaItem[] => {
  const response = isRecord(v) && isRecord(v['response']) ? v['response'] : null;
  const forPlayer = response ? (response[entityId] ?? Object.values(response)[0]) : null;
  const result = isRecord(forPlayer) && Array.isArray(forPlayer['result']) ? forPlayer['result'] : [];
  return result.map((r) => parseBrowseMedia(r, 1)).filter((r): r is MediaItem => r !== null);
};
