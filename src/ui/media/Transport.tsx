import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import type { DeviceCommand, SmartEntity } from '../../core/types';
import { cmd } from '../entityActions';
import { isPlaying, transportCaps } from './mediaApps';

interface Props {
  /** Used for labels. */
  readonly name: string;
  /** The player that receives the commands. */
  readonly target: SmartEntity;
  readonly disabled: boolean;
  readonly onRun: (commands: readonly DeviceCommand[]) => void;
  readonly large?: boolean;
}

/** Previous / play-pause / next, shown only where the player supports them. */
export function Transport({ name, target, disabled, onRun, large = false }: Props) {
  const caps = transportCaps(target);
  const playing = isPlaying(target);
  const btn = `rounded-md ${large ? 'p-2' : 'p-1'} text-slate-200 hover:bg-panel-hi disabled:cursor-not-allowed disabled:opacity-40`;
  const small = large ? 'h-5 w-5' : 'h-3.5 w-3.5';
  const main = large ? 'h-6 w-6' : 'h-4 w-4';
  return (
    <div className="flex shrink-0 items-center gap-1">
      {caps.previous && (
        <button type="button" disabled={disabled} onClick={() => onRun([cmd(target, 'media_previous_track')])} aria-label={`${name}: previous track`} className={btn}>
          <SkipBack className={small} aria-hidden />
        </button>
      )}
      {caps.playPause && (
        <button type="button" disabled={disabled} onClick={() => onRun([cmd(target, playing ? 'media_pause' : 'media_play')])} aria-label={`${name}: ${playing ? 'pause' : 'play'}`} className={btn}>
          {playing ? <Pause className={main} aria-hidden /> : <Play className={main} aria-hidden />}
        </button>
      )}
      {caps.next && (
        <button type="button" disabled={disabled} onClick={() => onRun([cmd(target, 'media_next_track')])} aria-label={`${name}: next track`} className={btn}>
          <SkipForward className={small} aria-hidden />
        </button>
      )}
    </div>
  );
}
