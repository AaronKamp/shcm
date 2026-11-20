import { create } from 'zustand';

export interface ScreensaverSettings {
  readonly enabled: boolean;
  /** Minutes with no input and no front-camera motion before it starts. */
  readonly idleMinutes: number;
  /** Seconds each photo stays up. */
  readonly intervalSec: number;
  /** Local or cloud-synced folders (OneDrive, Google Drive, Dropbox, Amazon Photos…). */
  readonly folders: readonly string[];
  readonly includeSubfolders: boolean;
  /** Public share links to albums/folders (Google Photos, Amazon Photos, OneDrive). */
  readonly links: readonly string[];
  /** Motion/occupancy sensor uids that count as "someone's out front"; null = auto (names with "front"). */
  readonly motionSensors: readonly string[] | null;
  /** Weather entity uid; '' = first weather entity. */
  readonly weather: string;
  /** 24-hour clock instead of 12-hour. */
  readonly clock24: boolean;
}

interface ScreensaverState extends ScreensaverSettings {
  /** Runtime only: the slideshow is showing. */
  readonly active: boolean;
}

const KEY = 'shcm.screensaver.v1';

const DEFAULTS: ScreensaverSettings = {
  enabled: false,
  idleMinutes: 20,
  intervalSec: 30,
  folders: [],
  includeSubfolders: true,
  links: [],
  motionSensors: null,
  weather: '',
  clock24: false,
};

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

const load = (): ScreensaverSettings => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return DEFAULTS;
    const r = raw as Record<string, unknown>;
    const num = (k: string, fallback: number, min: number, max: number): number => {
      const v = r[k];
      return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
    };
    return {
      enabled: r['enabled'] === true,
      idleMinutes: num('idleMinutes', DEFAULTS.idleMinutes, 1, 240),
      intervalSec: num('intervalSec', DEFAULTS.intervalSec, 5, 600),
      folders: strings(r['folders']),
      includeSubfolders: r['includeSubfolders'] !== false,
      links: strings(r['links']),
      motionSensors: Array.isArray(r['motionSensors']) ? strings(r['motionSensors']) : null,
      weather: typeof r['weather'] === 'string' ? r['weather'] : '',
      clock24: r['clock24'] === true,
    };
  } catch {
    return DEFAULTS;
  }
};

export const useScreensaverStore = create<ScreensaverState>()(() => ({ ...load(), active: false }));

const snapshot = (s: ScreensaverState): ScreensaverSettings => {
  const { active: _active, ...settings } = s;
  return settings;
};

export const updateScreensaver = (patch: Partial<ScreensaverSettings>): void => {
  useScreensaverStore.setState(patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot(useScreensaverStore.getState())));
  } catch {
    // Storage blocked: settings still apply until restart.
  }
};

export const setScreensaverActive = (active: boolean): void => {
  if (useScreensaverStore.getState().active !== active) useScreensaverStore.setState({ active });
};

window.addEventListener('storage', (e) => {
  if (e.key === KEY) useScreensaverStore.setState(load());
});
