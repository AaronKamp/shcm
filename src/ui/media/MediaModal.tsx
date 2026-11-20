import { Music, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SmartEntity } from '../../core/types';
import { AppSwitch } from './AppSwitch';
import { FallbackImage } from './FallbackImage';
import { playItemCommands, type AppKind } from './mediaApps';
import { useCommandRunner, useSpeakerApps } from './mediaHooks';
import { MediaLibrary } from './MediaLibrary';
import { Transport } from './Transport';

const text = (e: SmartEntity, key: string): string | undefined => {
  const v = e.attributes[key];
  return typeof v === 'string' && v ? v : undefined;
};

/** Album art: an absolute URL, or an HA-relative path loaded through the backend. */
const artwork = (e: SmartEntity): string | undefined => text(e, 'entity_picture');

/**
 * Full player for a speaker: what's playing with artwork and transport, and
 * the library of the chosen app. Playing an item moves that app to this
 * speaker first (pausing the other app).
 */
export function MediaModal({ speaker, onClose }: { speaker: SmartEntity; onClose: () => void }) {
  const { links, apps, active, target } = useSpeakerApps(speaker);
  const { busy, error, runAll } = useCommandRunner();
  const [libKind, setLibKind] = useState<AppKind | undefined>(active?.kind ?? apps[0]?.kind);
  const libApp = apps.find((a) => a.kind === libKind);
  const libPlayer = libApp?.player ?? speaker;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const loaded = target.state === 'playing' || target.state === 'paused';
  const title = loaded ? text(target, 'media_title') : undefined;
  const artist = text(target, 'media_artist') ?? text(target, 'media_album_artist');
  const album = text(target, 'media_album_name');
  const art = loaded ? artwork(target) : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal
        aria-label={`${speaker.name} player`}
        className="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 rounded-xl border border-line bg-panel p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <FallbackImage
            sources={art ? [art] : []}
            className="h-20 w-20 shrink-0 rounded-lg object-cover"
            fallback={
              <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-panel-hi text-slate-500">
                <Music className="h-8 w-8" aria-hidden />
              </span>
            }
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs uppercase tracking-wider text-slate-500">
              {speaker.name}
              {active ? ` · ${active.label}` : ''}
            </p>
            <p className="truncate text-base font-semibold text-slate-100">{title ?? 'Nothing playing'}</p>
            {title && <p className="truncate text-sm text-slate-400">{[artist, album].filter(Boolean).join(' · ')}</p>}
            <div className="mt-1 flex items-center gap-2">
              <Transport name={speaker.name} target={target} disabled={busy || !speaker.available} onRun={(c) => void runAll(c)} large />
              {error && <span className="truncate text-xs text-bad">{error}</span>}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close player" className="rounded-md p-1 text-slate-400 hover:bg-panel-hi hover:text-slate-100">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {apps.length > 1 && <AppSwitch speaker={speaker} apps={apps} selected={libApp} disabled={false} onPick={(a) => setLibKind(a.kind)} verb="Browse" />}
        <MediaLibrary
          key={libPlayer.uid}
          player={libPlayer}
          disabled={busy || !speaker.available}
          onPlay={(item) => void runAll(playItemCommands(speaker, apps, libApp, links, item))}
        />
      </div>
    </div>
  );
}
