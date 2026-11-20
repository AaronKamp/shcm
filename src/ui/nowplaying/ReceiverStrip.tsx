import { Power, Volume2, VolumeX } from 'lucide-react';
import { useMemo } from 'react';
import type { SmartEntity } from '../../core/types';
import { useDeviceStore } from '../../state/deviceStore';
import { useLayoutStore, withName } from '../../state/layoutStore';
import { useNowPlayingStore } from '../../state/nowPlayingStore';
import { cmd } from '../entityActions';
import { useCommandRunner } from '../media/mediaHooks';
import { receiverCaps, strings } from '../ReceiverControls';
import { useVolumeDraft } from '../useVolumeDraft';

/** Media players that look like an AV receiver: Denon's integration, or anything with sound modes. */
export const isReceiver = (e: SmartEntity): boolean =>
  e.domain === 'media_player' && (e.integration === 'denonavr' || strings(e.attributes['sound_mode_list']).length > 0);

/** Every receiver, and the one the strip shows (the user's pick, else a Denon, else the first receiver). */
export const useReceiver = (): { readonly receivers: readonly SmartEntity[]; readonly receiver: SmartEntity | undefined } => {
  const entities = useDeviceStore((s) => s.entities);
  const names = useLayoutStore((s) => s.names);
  const setting = useNowPlayingStore((s) => s.receiver);
  return useMemo(() => {
    const receivers = entities.filter(isReceiver).map((e) => withName(e, names));
    if (setting === 'none') return { receivers, receiver: undefined };
    const picked = setting ? receivers.find((e) => e.uid === setting) : undefined;
    return { receivers, receiver: picked ?? receivers.find((e) => e.integration === 'denonavr') ?? receivers[0] };
  }, [entities, names, setting]);
};

const select =
  'min-w-0 max-w-40 flex-1 truncate rounded-md border border-line bg-panel-hi px-2 py-1 text-xs text-slate-200 disabled:cursor-not-allowed disabled:opacity-50';

/** One slim row for the AVR: power, input, sound mode (Stereo, Direct, …), mute and volume. */
export function ReceiverStrip({ entity }: { entity: SmartEntity }) {
  const { busy, error, runAll } = useCommandRunner();
  const run = async (c: ReturnType<typeof cmd>): Promise<void> => {
    await runAll([c]);
  };
  const { volume, change } = useVolumeDraft(entity, run);
  const caps = receiverCaps(entity);
  const a = entity.attributes;
  const on = entity.state !== 'off' && entity.state !== 'standby';
  const disabled = busy || !entity.available;
  const muted = a['is_volume_muted'] === true;
  const source = typeof a['source'] === 'string' ? a['source'] : '';
  const mode = typeof a['sound_mode'] === 'string' ? a['sound_mode'] : '';
  const MuteIcon = muted ? VolumeX : Volume2;

  return (
    <div data-tile aria-label={`${entity.name} controls`} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-panel px-3 py-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => void run(cmd(entity, on ? 'turn_off' : 'turn_on'))}
        aria-pressed={on}
        aria-label={on ? `Turn off ${entity.name}` : `Turn on ${entity.name}`}
        title={on ? 'Turn off' : 'Turn on'}
        className={`shrink-0 rounded-full p-1.5 disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'bg-accent/20 text-accent' : 'text-slate-400 hover:bg-panel-hi hover:text-slate-100'}`}
      >
        <Power className="h-4 w-4" aria-hidden />
      </button>
      <span className="min-w-0 max-w-32 truncate text-xs uppercase tracking-wider text-slate-400" title={entity.name}>
        {entity.name}
      </span>

      {!on ? (
        <span className="text-xs text-slate-500">{entity.available ? 'Off' : 'Unavailable'}</span>
      ) : (
        <>
          {caps.sources.length > 0 && (
            <select value={source} disabled={disabled} onChange={(e) => void run(cmd(entity, 'select_source', { source: e.target.value }))} aria-label={`${entity.name} input`} title="Input" className={select}>
              {!caps.sources.includes(source) && <option value={source}>{source || 'Input…'}</option>}
              {caps.sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          {caps.modes.length > 0 && (
            <select value={mode} disabled={disabled} onChange={(e) => void run(cmd(entity, 'select_sound_mode', { sound_mode: e.target.value }))} aria-label={`${entity.name} sound mode`} title="Sound mode" className={select}>
              {!caps.modes.includes(mode) && <option value={mode}>{mode || 'Sound mode…'}</option>}
              {caps.modes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
          {(caps.volume || caps.mute) && (
            <div className="flex min-w-40 flex-[2] items-center gap-2 text-xs text-slate-400">
              {caps.mute ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void run(cmd(entity, 'volume_mute', { is_volume_muted: !muted }))}
                  aria-pressed={muted}
                  aria-label={muted ? `Unmute ${entity.name}` : `Mute ${entity.name}`}
                  title={muted ? 'Unmute' : 'Mute'}
                  className={`shrink-0 rounded-md p-1 disabled:cursor-not-allowed ${muted ? 'bg-bad/20 text-bad' : 'hover:bg-panel-hi'}`}
                >
                  <MuteIcon className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : (
                <Volume2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
              )}
              {caps.volume && (
                <>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={volume}
                    disabled={disabled}
                    onChange={(e) => change(Number(e.target.value))}
                    aria-label={`${entity.name} volume`}
                    aria-valuetext={muted ? `${volume}%, muted` : `${volume}%`}
                    className={`h-1.5 min-w-0 flex-1 cursor-pointer accent-accent disabled:cursor-not-allowed ${muted ? 'opacity-50' : ''}`}
                  />
                  <span className="w-8 shrink-0 text-right tabular-nums">{volume}%</span>
                </>
              )}
            </div>
          )}
        </>
      )}
      {error && <p className="w-full truncate text-xs text-bad">{error}</p>}
    </div>
  );
}
