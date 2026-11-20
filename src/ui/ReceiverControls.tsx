import { Volume2, VolumeX } from 'lucide-react';
import type { DeviceCommand, JsonValue, SmartEntity } from '../core/types';
import { cmd } from './entityActions';
import { useVolumeDraft } from './useVolumeDraft';

/** HA MediaPlayerEntityFeature bits. */
const FEATURE = { VOLUME_SET: 4, VOLUME_MUTE: 8, SELECT_SOURCE: 2048, SELECT_SOUND_MODE: 65536 } as const;

export const strings = (v: JsonValue | undefined): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * What this media player can do. Uses HA's `supported_features` bitmask when
 * present; otherwise infers from which attributes the entity reports.
 */
export const receiverCaps = (e: SmartEntity) => {
  const a = e.attributes;
  const bits = typeof a['supported_features'] === 'number' ? a['supported_features'] : null;
  const has = (bit: number, fallback: boolean): boolean => (bits === null ? fallback : (bits & bit) !== 0);
  const sources = strings(a['source_list']);
  const modes = strings(a['sound_mode_list']);
  return {
    volume: has(FEATURE.VOLUME_SET, typeof a['volume_level'] === 'number'),
    mute: has(FEATURE.VOLUME_MUTE, typeof a['is_volume_muted'] === 'boolean'),
    sources: has(FEATURE.SELECT_SOURCE, true) ? sources : [],
    modes: has(FEATURE.SELECT_SOUND_MODE, true) ? modes : [],
  };
};

/** True when there's anything beyond on/off to show (and the receiver is on). */
export const hasReceiverControls = (e: SmartEntity): boolean => {
  if (e.domain !== 'media_player' || e.state === 'off' || e.state === 'standby') return false;
  const c = receiverCaps(e);
  return c.volume || c.mute || c.sources.length > 0 || c.modes.length > 0;
};

interface Props {
  readonly entity: SmartEntity;
  readonly disabled: boolean;
  readonly onCommand: (command: DeviceCommand) => Promise<void>;
}

/** Volume slider, mute, input and sound-mode pickers for an AVR / media player. */
export function ReceiverControls({ entity, disabled, onCommand }: Props) {
  const caps = receiverCaps(entity);
  const a = entity.attributes;
  const muted = a['is_volume_muted'] === true;
  const source = typeof a['source'] === 'string' ? a['source'] : '';
  const mode = typeof a['sound_mode'] === 'string' ? a['sound_mode'] : '';
  const { volume, change: changeVolume } = useVolumeDraft(entity, onCommand);
  const MuteIcon = muted ? VolumeX : Volume2;
  const selectClass =
    'min-w-0 flex-1 rounded-md border border-line bg-panel-hi px-2 py-1 text-xs text-slate-200 disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div className="flex flex-col gap-2">
      {(caps.volume || caps.mute) && (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          {caps.mute ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => void onCommand(cmd(entity, 'volume_mute', { is_volume_muted: !muted }))}
              aria-pressed={muted}
              aria-label={muted ? `Unmute ${entity.name}` : `Mute ${entity.name}`}
              title={muted ? 'Unmute' : 'Mute'}
              className={`shrink-0 rounded-md p-1 ${muted ? 'bg-bad/20 text-bad' : 'hover:bg-panel-hi'} disabled:cursor-not-allowed`}
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
                onChange={(e) => changeVolume(Number(e.target.value))}
                aria-label={`${entity.name} volume`}
                aria-valuetext={muted ? `${volume}%, muted` : `${volume}%`}
                className={`h-1.5 min-w-0 flex-1 cursor-pointer accent-accent disabled:cursor-not-allowed ${muted ? 'opacity-50' : ''}`}
              />
              <span className="w-8 shrink-0 text-right tabular-nums">{volume}%</span>
            </>
          )}
        </div>
      )}
      {(caps.sources.length > 0 || caps.modes.length > 0) && (
        <div className="flex gap-2">
          {caps.sources.length > 0 && (
            <select
              value={source}
              disabled={disabled}
              onChange={(e) => void onCommand(cmd(entity, 'select_source', { source: e.target.value }))}
              aria-label={`${entity.name} input`}
              title="Input"
              className={selectClass}
            >
              {!caps.sources.includes(source) && <option value={source}>{source || 'Input…'}</option>}
              {caps.sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          {caps.modes.length > 0 && (
            <select
              value={mode}
              disabled={disabled}
              onChange={(e) => void onCommand(cmd(entity, 'select_sound_mode', { sound_mode: e.target.value }))}
              aria-label={`${entity.name} sound mode`}
              title="Sound mode"
              className={selectClass}
            >
              {!caps.modes.includes(mode) && <option value={mode}>{mode || 'Sound mode…'}</option>}
              {caps.modes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}
