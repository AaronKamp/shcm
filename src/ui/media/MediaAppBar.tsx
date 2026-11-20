import { Maximize2 } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { SmartEntity } from '../../core/types';
import { AppSwitch } from './AppSwitch';
import { isPlaying, nowPlaying, switchCommands, type LinkedApp } from './mediaApps';
import { useCommandRunner, useEffectiveLinks, useSpeakerApps } from './mediaHooks';
import { MediaModal } from './MediaModal';
import { Transport } from './Transport';

export const isOff = (e: SmartEntity): boolean => e.state === 'off' || e.state === 'standby';

/** True when the card should show the bar: apps are linked, or the speaker has something loaded. */
export const useHasMediaBar = (speaker: SmartEntity): boolean => {
  const linked = useEffectiveLinks(speaker) !== undefined;
  return speaker.domain === 'media_player' && (linked || nowPlaying(speaker) !== null || isPlaying(speaker) || speaker.state === 'paused');
};

/**
 * App switcher (Spotify / Music Assistant) plus now-playing and transport for a
 * speaker card. The now-playing line and the expand button open the full
 * player with the library.
 */
export function MediaAppBar({ speaker }: { speaker: SmartEntity }) {
  const { links, apps, active, target } = useSpeakerApps(speaker);
  const { busy, error, runAll } = useCommandRunner();
  const [open, setOpen] = useState(false);
  const title = nowPlaying(target);

  const switchTo = (app: LinkedApp): void => {
    if (links && app !== active) void runAll(switchCommands(speaker, apps, app, links));
  };

  const disabled = busy || !speaker.available;
  const idle = active ? `${active.label} · paused` : isOff(speaker) ? 'Pick an app or browse to start' : 'Nothing playing';

  return (
    <div className="flex flex-col gap-1.5">
      {apps.length > 0 && <AppSwitch speaker={speaker} apps={apps} selected={active} disabled={disabled} onPick={switchTo} />}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={title ? `${title} — open player` : 'Open player and library'}
          className={`min-w-0 flex-1 truncate rounded text-left text-xs hover:text-slate-100 hover:underline ${error ? 'text-bad' : 'text-slate-400'}`}
        >
          {error ?? title ?? idle}
        </button>
        <Transport name={speaker.name} target={target} disabled={disabled} onRun={(c) => void runAll(c)} />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Open ${speaker.name} player and library`}
          title="Open player and library"
          className="shrink-0 rounded-md p-1 text-slate-300 hover:bg-panel-hi"
        >
          <Maximize2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {open && createPortal(<MediaModal speaker={speaker} onClose={() => setOpen(false)} />, document.body)}
    </div>
  );
}
