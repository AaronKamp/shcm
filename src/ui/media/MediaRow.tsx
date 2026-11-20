import { ChevronRight, Disc3, Folder, ListMusic, Music, Play, Radio, User, type LucideIcon } from 'lucide-react';
import type { MediaItem } from '../../core/media';
import { FallbackImage } from './FallbackImage';

const CLASS_ICON: Readonly<Record<string, LucideIcon>> = {
  playlist: ListMusic,
  album: Disc3,
  artist: User,
  channel: Radio,
  podcast: Radio,
  track: Music,
  music: Music,
};

interface Props {
  readonly item: MediaItem;
  readonly disabled: boolean;
  readonly onOpen: (item: MediaItem) => void;
  readonly onPlay: (item: MediaItem) => void;
}

/** One library entry: tap to open (folders, artists, albums) or play; separate play button. */
export function MediaRow({ item: c, disabled, onOpen, onPlay }: Props) {
  const Icon = CLASS_ICON[c.mediaClass] ?? Folder;
  return (
    <li className="flex items-center gap-2 px-2 py-1.5">
      <button
        type="button"
        disabled={disabled || (!c.canExpand && !c.canPlay)}
        onClick={() => (c.canExpand ? onOpen(c) : onPlay(c))}
        className="flex min-w-0 flex-1 items-center gap-2 rounded text-left hover:text-white disabled:cursor-default"
      >
        <FallbackImage
          sources={c.thumbnail ? [c.thumbnail] : []}
          className="h-9 w-9 shrink-0 rounded object-cover"
          fallback={
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-panel-hi text-slate-400">
              <Icon className="h-4 w-4" aria-hidden />
            </span>
          }
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-slate-100">{c.title}</span>
          <span className="block truncate text-xs capitalize text-slate-500">{c.mediaClass}</span>
        </span>
        {c.canExpand && <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />}
      </button>
      {c.canPlay && (
        <button type="button" disabled={disabled} onClick={() => onPlay(c)} aria-label={`Play ${c.title}`} title="Play" className="shrink-0 rounded-full bg-panel-hi p-1.5 text-slate-100 hover:bg-accent disabled:opacity-50">
          <Play className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </li>
  );
}
