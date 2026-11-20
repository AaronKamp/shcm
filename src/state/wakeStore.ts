import { create } from 'zustand';

export type WakeStatus = 'off' | 'starting' | 'listening' | 'error';

interface WakeState {
  /** User setting, shared by both windows (localStorage). */
  readonly enabled: boolean;
  /** Detector state; only the dashboard window runs the detector. */
  readonly status: WakeStatus;
  readonly error: string | null;
}

const KEY = 'shcm.wake.v1';

const readEnabled = (): boolean => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return true;
    const v: unknown = JSON.parse(raw);
    return typeof v === 'object' && v !== null && 'enabled' in v ? v.enabled !== false : true;
  } catch {
    return true;
  }
};

export const useWakeStore = create<WakeState>()(() => ({ enabled: readEnabled(), status: 'off', error: null }));

export const setWakeStatus = (status: WakeStatus, error: string | null = null): void => useWakeStore.setState({ status, error });

export const setWakeEnabled = (enabled: boolean): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ enabled }));
  } catch {
    // Storage blocked: the setting still applies until restart.
  }
  useWakeStore.setState({ enabled });
};

// The overlay window's Settings and the dashboard stay in step.
window.addEventListener('storage', (e) => {
  if (e.key === KEY) useWakeStore.setState({ enabled: readEnabled() });
});
