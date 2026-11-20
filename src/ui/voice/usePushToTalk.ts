import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect } from 'react';
import { inTauri } from '../../platform/window';
import { acceleratorKeys, matchesAccelerator, useShortcutStore } from '../../state/shortcutStore';
import type { VoiceSession } from '../../voice/VoiceSession';

/** Emitted by src-tauri on the global push-to-talk shortcut. Must match `PttPayload` in desktop.rs. */
export const PTT_EVENT = 'shcm://ptt';

interface PttPayload {
  readonly pressed: boolean;
}

/**
 * Hold-to-talk. Two sources, both idempotent:
 * - In-window keydown/keyup (browser dev, or the focused Tauri window).
 * - Global Tauri shortcut, delivered only to the overlay window, so the
 *   assistant works while another app has focus.
 */
export function usePushToTalk(session: VoiceSession | null): void {
  const accelerator = useShortcutStore((s) => s.ptt);
  useEffect(() => {
    if (!session) return;
    const isPttCombo = (e: KeyboardEvent): boolean => matchesAccelerator(e, accelerator);
    const comboKeys = new Set(acceleratorKeys(accelerator));
    let held = false;
    const press = (): void => {
      if (held) return;
      held = true;
      void session.beginTalk('ptt');
    };
    const release = (): void => {
      if (!held) return;
      held = false;
      session.endTalk();
    };

    const onDown = (e: KeyboardEvent): void => {
      if (!isPttCombo(e)) return;
      e.preventDefault();
      if (!e.repeat) press();
    };
    // Releasing any key of the combo ends the turn.
    const onUp = (e: KeyboardEvent): void => {
      if (held && (comboKeys.has(e.key) || comboKeys.has(e.code) || comboKeys.has(e.code.replace(/^(Key|Digit)/, '')))) {
        e.preventDefault();
        release();
      }
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', release);

    let unlisten: (() => void) | null = null;
    let disposed = false;
    if (inTauri() && getCurrentWindow().label === 'overlay') {
      void listen<PttPayload>(PTT_EVENT, (e) => (e.payload.pressed ? press() : release())).then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    }

    return () => {
      disposed = true;
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', release);
      unlisten?.();
      release();
    };
  }, [session, accelerator]);
}
