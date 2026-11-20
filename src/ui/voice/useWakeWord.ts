import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef } from 'react';
import { errorMessage } from '../../core/DeviceProvider';
import { inTauri } from '../../platform/window';
import { setWakeStatus, useWakeStore } from '../../state/wakeStore';
import { WakeWordListener } from '../../voice/wakeword/WakeWordListener';

/** Emitted by src-tauri `voice_wake`. Must match `WAKE_EVENT` / `WakePayload` in desktop.rs. */
export const WAKE_EVENT = 'shcm://wake';

interface WakePayload {
  /** Window that should answer: the dashboard when it has focus, else the overlay. */
  readonly label: string;
}

/**
 * Runs the always-on detector (dashboard window only, so there's one per app;
 * it keeps listening while the window is hidden to tray). A detection asks the
 * native side which window should answer — only that tiny signal crosses IPC.
 */
export function useWakeWordListener(): void {
  const enabled = useWakeStore((s) => s.enabled);
  useEffect(() => {
    if (!enabled || !inTauri()) {
      setWakeStatus('off');
      return;
    }
    let disposed = false;
    const listener = new WakeWordListener((score) => {
      console.info(`[wake] heard wake word (${score.toFixed(2)})`);      invoke('voice_wake').catch((err: unknown) => console.warn('[wake] voice_wake failed', err));
    });
    setWakeStatus('starting');
    listener.start().then(
      () => !disposed && setWakeStatus('listening'),
      (err: unknown) => {
        if (disposed) return;
        console.warn('[wake] could not start', err);
        setWakeStatus('error', errorMessage(err));
      },
    );
    return () => {
      disposed = true;
      void listener.stop();
    };
  }, [enabled]);
}

/** Calls `onWake` when the native side routes a wake word to this window. */
export function useWakeEvent(onWake: () => void): void {
  const handler = useRef(onWake);
  useEffect(() => {
    handler.current = onWake;
  });
  useEffect(() => {
    if (!inTauri()) return;
    const label = getCurrentWindow().label;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void listen<WakePayload>(WAKE_EVENT, (e) => {
      if (e.payload.label === label) handler.current();
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
