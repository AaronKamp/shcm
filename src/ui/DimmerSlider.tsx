import { Sun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { DeviceCommand, SmartEntity } from '../core/types';
import { cmd } from './entityActions';

/** Wait this long after the last slider movement before sending (avoids flooding HA). */
const SEND_DELAY_MS = 250;
/** Give up waiting for the device to report the new level after this long. */
const HOLD_MS = 3000;

/**
 * True for lights that support brightness. Home Assistant lists
 * `supported_color_modes`; anything other than `onoff` can dim. Without that
 * attribute, a numeric `brightness` is the signal.
 */
/** Fixed height of the slider row, so light tiles without a dimmer can reserve the same space. */
export const DIMMER_ROW = 'h-5';

export const isDimmable =(e: SmartEntity): boolean => {
  if (e.domain !== 'light') return false;
  const modes = e.attributes['supported_color_modes'];
  if (Array.isArray(modes)) return modes.some((m) => typeof m === 'string' && m !== 'onoff');
  return typeof e.attributes['brightness'] === 'number';
};

/** Current level as 0–100 (off = 0). HA brightness is 0–255. */
const levelOf = (e: SmartEntity): number => {
  if (e.state !== 'on') return 0;
  const b = e.attributes['brightness'];
  return typeof b === 'number' ? Math.round((b / 255) * 100) : 100;
};

interface Props {
  readonly entity: SmartEntity;
  readonly disabled: boolean;
  readonly onCommand: (command: DeviceCommand) => Promise<void>;
}

/**
 * Brightness slider. Moving it turns the light on at that level; 0 turns it off.
 * Shows the dragged value until the device reports back, so it doesn't snap back.
 */
export function DimmerSlider({ entity, disabled, onCommand }: Props) {
  const reported = levelOf(entity);
  const [draft, setDraft] = useState<number | null>(null);
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The device reported a new level: show it.
  useEffect(() => setDraft(null), [reported]);
  useEffect(
    () => () => {
      if (sendTimer.current) clearTimeout(sendTimer.current);
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    [],
  );

  const change = (pct: number): void => {
    setDraft(pct);
    if (sendTimer.current) clearTimeout(sendTimer.current);
    if (holdTimer.current) clearTimeout(holdTimer.current);
    sendTimer.current = setTimeout(() => {
      void onCommand(pct === 0 ? cmd(entity, 'turn_off') : cmd(entity, 'turn_on', { brightness: Math.max(1, Math.round((pct / 100) * 255)) }));
      holdTimer.current = setTimeout(() => setDraft(null), HOLD_MS);
    }, SEND_DELAY_MS);
  };

  const value = draft ?? reported;
  return (
    <label className={`flex items-center gap-2 text-xs text-slate-400 ${DIMMER_ROW}`}>
      <Sun className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => change(Number(e.target.value))}
        aria-label={`${entity.name} brightness`}
        aria-valuetext={value === 0 ? 'Off' : `${value}%`}
        className="h-1.5 min-w-0 flex-1 cursor-pointer accent-accent disabled:cursor-not-allowed"
      />
      <span className="w-8 shrink-0 text-right tabular-nums">{value === 0 ? 'Off' : `${value}%`}</span>
    </label>
  );
}
