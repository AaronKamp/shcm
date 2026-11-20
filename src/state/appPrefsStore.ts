import { create } from 'zustand';

export const DEFAULT_TITLE = 'Smart Home Command';

interface AppPrefs {
  /** Name shown in the header and the window title bar. */
  readonly title: string;
  /** Focus view: fullscreen over the taskbar. Restored on launch. */
  readonly focus: boolean;
}

const KEY = 'shcm.appPrefs.v1';

const load = (): AppPrefs => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return { title: DEFAULT_TITLE, focus: false };
    const r = raw as Record<string, unknown>;
    const title = typeof r['title'] === 'string' ? r['title'].trim().slice(0, 60) : '';
    return { title: title || DEFAULT_TITLE, focus: r['focus'] === true };
  } catch {
    return { title: DEFAULT_TITLE, focus: false };
  }
};

export const useAppPrefsStore = create<AppPrefs>()(() => load());

export const updateAppPrefs = (patch: Partial<AppPrefs>): void => {
  useAppPrefsStore.setState(patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(useAppPrefsStore.getState()));
  } catch {
    // Storage blocked: applies until restart.
  }
};
