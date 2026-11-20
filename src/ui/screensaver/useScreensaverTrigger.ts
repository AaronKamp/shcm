import { useEffect, useMemo, useRef } from 'react';
import { useDeviceStore } from '../../state/deviceStore';
import { setScreensaverActive, useScreensaverStore } from '../../state/screensaverStore';
import { useViewStore } from '../../state/viewStore';
import { useVoiceStore } from '../../state/voiceStore';
import { watchedSensors } from './sensors';

const CHECK_MS = 10_000;
const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * Starts the screensaver once the dashboard has had no touch/mouse/keyboard
 * input AND no front-camera motion for `idleMinutes`. Motion or voice
 * activity ends it; input ends it through the screensaver's own handlers.
 */
export function useScreensaverTrigger(): void {
  const enabled = useScreensaverStore((s) => s.enabled);
  const idleMinutes = useScreensaverStore((s) => s.idleMinutes);
  const sensorSetting = useScreensaverStore((s) => s.motionSensors);
  const entities = useDeviceStore((s) => s.entities);
  const sensors = useMemo(() => watchedSensors(entities, sensorSetting), [entities, sensorSetting]);
  const lastInput = useRef(Date.now());
  const lastMotion = useRef(0);
  // Entities update every few seconds; the idle timer reads sensors through a ref so it isn't reset.
  const motionOn = useRef(false);

  useEffect(() => {
    const onInput = (): void => {
      lastInput.current = Date.now();
    };
    for (const e of INPUT_EVENTS) window.addEventListener(e, onInput, { passive: true, capture: true });
    return () => {
      for (const e of INPUT_EVENTS) window.removeEventListener(e, onInput, { capture: true });
    };
  }, []);

  // Motion: a sensor that is on counts as "now"; one that turned off, as when it did.
  useEffect(() => {
    const now = Date.now();
    let latest = 0;
    for (const s of sensors) latest = Math.max(latest, s.state === 'on' ? now : s.lastChanged);
    const fresh = latest > lastMotion.current;
    lastMotion.current = Math.max(lastMotion.current, latest);
    motionOn.current = sensors.some((s) => s.state === 'on');
    if (fresh && motionOn.current) setScreensaverActive(false);
  }, [sensors]);

  // Talking to the assistant wakes the dashboard so the voice pill is visible.
  useEffect(
    () =>
      useVoiceStore.subscribe((v) => {
        if (v.status !== 'off' && v.status !== 'error') {
          lastInput.current = Date.now();
          setScreensaverActive(false);
        }
      }),
    [],
  );

  useEffect(() => {
    if (!enabled) {
      setScreensaverActive(false);
      return;
    }
    const timer = setInterval(() => {
      const view = useViewStore.getState();
      const voice = useVoiceStore.getState().status;
      if (useScreensaverStore.getState().active || !view.windowVisible || !view.documentVisible) return;
      if (voice !== 'off' && voice !== 'error') return;
      const quietSince = Math.max(lastInput.current, motionOn.current ? Date.now() : lastMotion.current);
      if (Date.now() - quietSince >= idleMinutes * 60_000) setScreensaverActive(true);
    }, CHECK_MS);
    return () => clearInterval(timer);
  }, [enabled, idleMinutes]);
}

/** Starts the screensaver right away (Settings → Preview). */
export const previewScreensaver = (): void => setScreensaverActive(true);
