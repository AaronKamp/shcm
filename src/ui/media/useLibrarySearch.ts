import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../core/DeviceProvider';
import { SEARCH_MEDIA_FEATURE, type MediaItem } from '../../core/media';
import type { SmartEntity } from '../../core/types';
import { searchMedia } from '../../state/deviceStore';

export type SearchKind = 'all' | 'artist' | 'album' | 'track' | 'playlist';

export const SEARCH_KINDS: readonly { readonly kind: SearchKind; readonly label: string }[] = [
  { kind: 'all', label: 'All' },
  { kind: 'artist', label: 'Artists' },
  { kind: 'album', label: 'Albums' },
  { kind: 'track', label: 'Tracks' },
  { kind: 'playlist', label: 'Playlists' },
];

/** Players that say they support HA search (or don't report features, like the mock). */
export const canSearch = (player: SmartEntity): boolean => {
  const bits = player.attributes['supported_features'];
  return typeof bits !== 'number' || (bits & SEARCH_MEDIA_FEATURE) !== 0;
};

export interface LibrarySearch {
  readonly query: string;
  readonly setQuery: (q: string) => void;
  readonly kind: SearchKind;
  readonly setKind: (k: SearchKind) => void;
  /** null while idle (no query) or loading. */
  readonly results: readonly MediaItem[] | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/** Debounced library search; stale responses are discarded. */
export const useLibrarySearch = (player: SmartEntity): LibrarySearch => {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<SearchKind>('all');
  const [results, setResults] = useState<readonly MediaItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const playerRef = useRef(player);
  playerRef.current = player;

  useEffect(() => {
    const q = query.trim();
    setResults(null);
    setError(null);
    if (!q) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      searchMedia(playerRef.current, { query: q, ...(kind === 'all' ? {} : { classes: [kind] }) })
        .then((r) => !cancelled && setResults(r))
        .catch((err: unknown) => !cancelled && setError(errorMessage(err)))
        .finally(() => !cancelled && setLoading(false));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, kind, player.uid]);

  return { query, setQuery, kind, setKind, results, loading, error };
};
