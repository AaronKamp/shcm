import { useEffect, useState } from 'react';
import type { SmartEntity } from '../../core/types';
import { searchMedia } from '../../state/deviceStore';
import { looksMusicAssistant } from '../media/mediaApps';
import { canSearch } from '../media/useLibrarySearch';

const text = (e: SmartEntity, key: string): string | undefined => {
  const v = e.attributes[key];
  return typeof v === 'string' && v ? v : undefined;
};

export const hasMedia = (e: SmartEntity): boolean => e.state === 'playing' || e.state === 'paused' || e.state === 'buffering';

/** Album art for what's loaded on the player. */
export const albumArt = (e: SmartEntity): string | undefined => (hasMedia(e) ? text(e, 'entity_picture') : undefined);

/** The artist of what's loaded, if any. */
export const currentArtist = (e: SmartEntity): string | undefined =>
  hasMedia(e) ? (text(e, 'media_artist') ?? text(e, 'media_album_artist')) : undefined;

/** Which app is playing: an app the player names, else the integration that made it. */
export const appDomain = (e: SmartEntity): string | undefined => {
  const app = (text(e, 'app_id') ?? text(e, 'app_name') ?? '').toLowerCase();
  if (app.includes('spotify')) return 'spotify';
  if (app.includes('music_assistant') || looksMusicAssistant(e)) return 'music_assistant';
  if (app.includes('plex')) return 'plex';
  if (app.includes('youtube')) return 'youtube';
  return e.integration;
};

/**
 * The app's logo from Home Assistant's public brand images (the same ones
 * HA's own UI shows). Only the integration name is sent.
 */
export const appLogo = (domain: string | undefined): string | undefined =>
  domain && /^[a-z0-9_]+$/.test(domain) ? `https://brands.home-assistant.io/_/${domain}/icon.png` : undefined;

const artistCache = new Map<string, Promise<string | null>>();

/** Artist photo via a Music Assistant library search (exact name match). */
const lookupArtist = (artist: string, searcher: SmartEntity): Promise<string | null> => {
  const key = artist.toLowerCase();
  let hit = artistCache.get(key);
  if (!hit) {
    hit = searchMedia(searcher, { query: artist, classes: ['artist'] })
      .then((items) => items.find((i) => i.mediaClass === 'artist' && i.title.toLowerCase() === key && i.thumbnail)?.thumbnail ?? null)
      .catch(() => {
        artistCache.delete(key);
        return null;
      });
    artistCache.set(key, hit);
  }
  return hit;
};

/** Photo of `artist`, looked up through any searchable Music Assistant player. */
export const useArtistImage = (artist: string | undefined, players: readonly SmartEntity[]): string | undefined => {
  const searcher = players.find((p) => looksMusicAssistant(p) && p.available && canSearch(p));
  const searcherUid = searcher?.uid;
  const [image, setImage] = useState<string | undefined>(undefined);
  useEffect(() => {
    setImage(undefined);
    if (!artist || !searcher) return;
    let cancelled = false;
    void lookupArtist(artist, searcher).then((url) => !cancelled && setImage(url ?? undefined));
    return () => {
      cancelled = true;
    };
    // Re-run only when the artist or the searching player changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artist, searcherUid]);
  return image;
};
