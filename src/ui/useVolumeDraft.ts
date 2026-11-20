import { useEffect, useRef, useState } from 'react';
import type { DeviceCommand, SmartEntity } from '../core/types';
import { cmd } from './entityActions';

/** Wait this long after the last slider movement before sending. */
const SEND_DELAY_MS = 250;
/** Give up waiting for the receiver to report the new volume after this long. */
const HOLD_MS = 3000;

/**
 * Volume slider state for a media player: shows the dragged value right away,
 * sends it once the slider settles, and snaps back to what the device reports.
 */
export const useVolumeDraft = (entity: SmartEntity, onCommand: (command: DeviceCommand) => Promise<void>) => {
  const a = entity.attributes;
  const reported = typeof a['volume_level'] === 'number' ? Math.round(a['volume_level'] * 100) : 0;
  const [draft, setDraft] = useState<number | null>(null);
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The receiver reported a new volume: show it.
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
      void onCommand(cmd(entity, 'volume_set', { volume_level: pct / 100 }));
      holdTimer.current = setTimeout(() => setDraft(null), HOLD_MS);
    }, SEND_DELAY_MS);
  };

  return { volume: draft ?? reported, change };
};
