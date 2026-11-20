import { Library, Music, Settings2, Speaker } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { SmartEntity } from '../../core/types';
import { useNowPlayingStore } from '../../state/nowPlayingStore';
import { FallbackImage } from '../media/FallbackImage';
import { useCommandRunner, useSpeakerApps, useVolumeEntity } from '../media/mediaHooks';
import { MediaModal } from '../media/MediaModal';
import { Transport } from '../media/Transport';
import { ReceiverControls } from '../ReceiverControls';
import { albumArt, appDomain, appLogo, currentArtist, hasMedia, useArtistImage } from './artwork';
import { NowPlayingSettings } from './NowPlayingSettings';
import { useReceiver } from './ReceiverStrip';
import { speakerLabel, useNowPlayingTarget } from './useNowPlaying';

const text = (e: SmartEntity, key: string): string | undefined => {
  const v = e.attributes[key];
  return typeof v === 'string' && v ? v : undefined;
};

/** Artwork box: centered and capped when the card is narrow, a fixed square beside the details when wide. */
const ART = 'mx-auto aspect-square w-full max-w-56 shrink-0 rounded-lg object-cover @md:mx-0 @md:h-40 @md:w-40 @3xl:h-48 @3xl:w-48';

const APP_LABEL: Readonly<Record<string, string>> = { spotify: 'Spotify', music_assistant: 'Music Assistant', cast: 'Google Cast', plex: 'Plex', youtube: 'YouTube' };

/**
 * One card for what's playing on the chosen speaker(s): artwork (album art →
 * artist photo → app logo → the user's default picture → a music icon),
 * track details, transport, volume, and the library. Several speakers play
 * as a group (see `planGroup`).
 */
export function NowPlayingCard() {
  const { candidates, chosen, auto, plan } = useNowPlayingTarget();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);

  if (!plan) {
    return (
      <div className="rounded-xl border border-dashed border-line p-4 text-sm text-slate-400">
        No speakers found. Music players from Home Assistant or Music Assistant appear here.
      </div>
    );
  }

  return (
    <>
      <NowPlayingBody
        speaker={plan.player}
        label={speakerLabel(chosen)}
        auto={auto}
        players={candidates}
        groupNote={plan.kind === 'unsupported' ? 'Not synced: open settings to group these speakers' : plan.kind === 'joinable' ? 'Not grouped yet: open settings to group' : undefined}
        onSettings={() => setSettingsOpen(true)}
        onLibrary={() => setLibraryOpen(true)}
      />
      {settingsOpen && createPortal(<NowPlayingSettings onClose={() => setSettingsOpen(false)} />, document.body)}
      {libraryOpen && createPortal(<MediaModal speaker={plan.player} onClose={() => setLibraryOpen(false)} />, document.body)}
    </>
  );
}

interface BodyProps {
  readonly speaker: SmartEntity;
  readonly label: string;
  readonly auto: boolean;
  readonly players: readonly SmartEntity[];
  readonly groupNote: string | undefined;
  readonly onSettings: () => void;
  readonly onLibrary: () => void;
}

function NowPlayingBody({ speaker, label, auto, players, groupNote, onSettings, onLibrary }: BodyProps) {
  const { active, target } = useSpeakerApps(speaker);
  const { busy, error, runAll } = useCommandRunner();
  const volumeEntity = useVolumeEntity(speaker);
  const { receiver } = useReceiver();
  const defaultImage = useNowPlayingStore((s) => s.defaultImage);
  const loaded = hasMedia(target);
  const artist = currentArtist(target);
  const artistImage = useArtistImage(artist, players);
  const domain = loaded ? appDomain(target) : undefined;
  const sources = [albumArt(target), artistImage, appLogo(domain), defaultImage ?? undefined].filter((s): s is string => Boolean(s));
  const title = loaded ? text(target, 'media_title') : undefined;
  const album = text(target, 'media_album_name');
  const appLabel = active?.label ?? (domain ? APP_LABEL[domain] : undefined);
  const disabled = busy || !speaker.available;

  return (
    // Laid out by the card's own width (a container query), since its group can be full, ⅔, ½ or ⅓ wide.
    <div className="@container">
    <article data-tile aria-label="Now playing" className="flex flex-col gap-4 rounded-xl border border-line bg-panel p-4 @md:flex-row">
      <FallbackImage
        key={speaker.uid}
        sources={sources}
        className={ART}
        fallback={
          <span className={`${ART} flex items-center justify-center bg-panel-hi text-slate-500`}>
            <Music className="h-12 w-12" aria-hidden />
          </span>
        }
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSettings}
            title="Choose speakers"
            className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs uppercase tracking-wider text-slate-400 hover:bg-panel-hi hover:text-slate-100"
          >
            <Speaker className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{label}</span>
            {auto && <span className="normal-case tracking-normal text-slate-500">(auto)</span>}
          </button>
          {appLabel && <span className="shrink-0 rounded-full bg-panel-hi px-2 py-0.5 text-xs text-slate-300">{appLabel}</span>}
          <button type="button" onClick={onSettings} aria-label="Now Playing settings" title="Speakers, grouping and default picture" className="ml-auto rounded-md p-1 text-slate-400 hover:bg-panel-hi hover:text-slate-100">
            <Settings2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-slate-100">{title ?? (speaker.available ? 'Nothing playing' : `${speaker.name} is unavailable`)}</p>
          {title && <p className="truncate text-sm text-slate-400">{[artist, album].filter(Boolean).join(' · ')}</p>}
          {groupNote && <p className="text-xs text-warn">{groupNote}</p>}
          {error && <p className="truncate text-xs text-bad">{error}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Transport name={label} target={target} disabled={disabled} onRun={(c) => void runAll(c)} large />
          <button
            type="button"
            onClick={onLibrary}
            disabled={!speaker.available}
            className="ml-auto flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-sm text-slate-200 hover:bg-panel-hi disabled:opacity-50"
          >
            <Library className="h-4 w-4" aria-hidden /> Library
          </button>
        </div>
        {/* The receiver strip below the card already has these. */}
        {volumeEntity.uid !== receiver?.uid && (
          <ReceiverControls
            entity={volumeEntity}
            disabled={disabled}
            onCommand={async (c) => {
              await runAll([c]);
            }}
          />
        )}
      </div>
    </article>
    </div>
  );
}
