import { ChevronLeft, Play, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../core/DeviceProvider';
import type { BrowseRequest, MediaItem } from '../../core/media';
import type { SmartEntity } from '../../core/types';
import { browseMedia } from '../../state/deviceStore';
import { MediaRow } from './MediaRow';
import { canSearch, SEARCH_KINDS, useLibrarySearch } from './useLibrarySearch';

interface Crumb extends BrowseRequest {
  readonly title: string;
}

interface Props {
  /** The player whose library is browsed (Spotify, Music Assistant or the speaker). */
  readonly player: SmartEntity;
  readonly disabled: boolean;
  readonly onPlay: (item: MediaItem) => void;
}

/** HA media sources that aren't music (cameras, snapshots, TTS…), hidden from music libraries. */
const NOT_MUSIC = /^media-source:\/\/(camera|image|image_upload|ai_task|tts|unifiprotect)(\/|$)/;

/** HA's message when a player (e.g. Spotify while idle) can't browse right now. */
const friendlyError = (message: string, player: SmartEntity): string =>
  /does not support browsing/i.test(message)
    ? `${player.name} can't show its library right now. Spotify only allows browsing while it's playing; your Spotify artists and playlists are also in Music Assistant.`
    : message;

/** Folder-by-folder library browser with search, a filter and play buttons. */
export function MediaLibrary({ player, disabled, onPlay }: Props) {
  const [stack, setStack] = useState<readonly Crumb[]>([{ title: 'Library' }]);
  const [item, setItem] = useState<MediaItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const search = useLibrarySearch(player);
  const searchable = canSearch(player);
  const searching = search.query.trim() !== '';
  const here = stack[stack.length - 1] ?? { title: 'Library' };
  // The player object changes with every state update (now playing, volume);
  // only a different player should re-browse.
  const playerRef = useRef(player);
  playerRef.current = player;

  useEffect(() => {
    let cancelled = false;
    setItem(null);
    setError(null);
    setFilter('');
    browseMedia(playerRef.current, { ...(here.contentId ? { contentId: here.contentId } : {}), ...(here.contentType ? { contentType: here.contentType } : {}) })
      .then((res) => !cancelled && setItem(res))
      .catch((err: unknown) => !cancelled && setError(friendlyError(errorMessage(err), playerRef.current)));
    return () => {
      cancelled = true;
    };
  }, [playerRef, player.uid, here.contentId, here.contentType, stack.length]);

  const open = (c: MediaItem): void => {
    search.setQuery('');
    setStack((s) => [...s, { title: c.title, contentId: c.contentId, contentType: c.contentType }]);
  };
  const q = filter.trim().toLowerCase();
  const folder = (item?.children ?? []).filter((c) => !NOT_MUSIC.test(c.contentId) && (!q || c.title.toLowerCase().includes(q)));
  const rows = searching ? (search.results ?? []) : folder;
  const shownError = searching ? search.error : error;
  const loading = searching ? search.loading : !error && !item;
  const empty = searching ? (search.results !== null && rows.length === 0 ? 'No matches in the library.' : null) : item && rows.length === 0 ? (q ? 'No matches.' : 'Nothing here.') : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {searchable && (
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 rounded-md border border-line bg-panel-hi px-2 py-1">
            <Search className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
            <input
              type="search"
              value={search.query}
              onChange={(e) => search.setQuery(e.target.value)}
              placeholder="Search artists, albums, tracks…"
              aria-label="Search the library"
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none"
            />
          </label>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Search in">
            {SEARCH_KINDS.map(({ kind, label }) => (
              <button
                key={kind}
                type="button"
                aria-pressed={search.kind === kind}
                onClick={() => search.setKind(kind)}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${search.kind === kind ? 'border-accent bg-accent/20 text-white' : 'border-line text-slate-400 hover:bg-panel-hi'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        {!searching && stack.length > 1 && (
          <button type="button" onClick={() => setStack((s) => s.slice(0, -1))} aria-label="Back" className="rounded-md p-1 text-slate-300 hover:bg-panel-hi">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
        )}
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">{searching ? `Results for “${search.query.trim()}”` : (item?.title ?? here.title)}</h3>
        {!searching && item?.canPlay && stack.length > 1 && (
          <button type="button" disabled={disabled} onClick={() => onPlay(item)} className="flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs font-medium text-white disabled:opacity-50">
            <Play className="h-3.5 w-3.5" aria-hidden /> Play all
          </button>
        )}
      </div>
      {!searching && (item?.children?.length ?? 0) > 8 && (
        <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter this list…" aria-label="Filter this list" className="rounded-md border border-line bg-panel-hi px-2 py-1 text-sm text-slate-100" />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-line">
        {shownError && <p className="p-3 text-sm text-bad">{shownError}</p>}
        {!shownError && loading && <p className="p-3 text-sm text-slate-400">{searching ? 'Searching…' : 'Loading…'}</p>}
        {!shownError && empty && <p className="p-3 text-sm text-slate-400">{empty}</p>}
        <ul className="divide-y divide-line">
          {rows.map((c) => (
            <MediaRow key={`${c.contentType}:${c.contentId}`} item={c} disabled={disabled} onOpen={open} onPlay={onPlay} />
          ))}
        </ul>
      </div>
    </div>
  );
}
