import { create } from 'zustand';
import { isRecord } from '../core/json';

/**
 * The dashboard's Now Playing card: which speakers it controls (one, or
 * several to play as a group), an optional fallback picture, and whether
 * it's shown. Saved per machine; synced between the app's windows.
 */
interface NowPlayingSettings {
  readonly visible: boolean;
  /** Speaker uids; empty = follow whatever is playing. */
  readonly speakers: readonly string[];
  /** `data:image/…` picture shown when nothing better is available. */
  readonly defaultImage: string | null;
  /** Receiver strip under the card: '' = pick the AVR automatically, 'none' = hidden, else an entity uid. */
  readonly receiver: string;
}

interface NowPlayingState extends NowPlayingSettings {
  setReceiver: (receiver: string) => void;
  setVisible: (visible: boolean) => void;
  setSpeakers: (uids: readonly string[]) => void;
  setDefaultImage: (dataUrl: string | null) => void;
}

const STORAGE_KEY = 'shcm.nowPlaying.v1';
const DEFAULTS: NowPlayingSettings = { visible: true, speakers: [], defaultImage: null, receiver: '' };

const load = (): NowPlayingSettings => {
  try {
    const r: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!isRecord(r)) return DEFAULTS;
    const speakers = Array.isArray(r['speakers']) ? r['speakers'].filter((s): s is string => typeof s === 'string') : [];
    const img = r['defaultImage'];
    return {
      visible: r['visible'] !== false,
      speakers,
      defaultImage: typeof img === 'string' && img.startsWith('data:image/') ? img : null,
      receiver: typeof r['receiver'] === 'string' ? r['receiver'] : '',
    };
  } catch {
    return DEFAULTS;
  }
};

const snapshot = (s: NowPlayingSettings): string =>
  JSON.stringify({ visible: s.visible, speakers: s.speakers, defaultImage: s.defaultImage, receiver: s.receiver });

export const useNowPlayingStore = create<NowPlayingState>()((set) => ({
  ...load(),
  setReceiver: (receiver) => set({ receiver }),
  setVisible: (visible) => set({ visible }),
  setSpeakers: (uids) => set({ speakers: [...new Set(uids)] }),
  setDefaultImage: (defaultImage) => set({ defaultImage }),
}));

let lastSaved = snapshot(useNowPlayingStore.getState());
useNowPlayingStore.subscribe((s) => {
  const json = snapshot(s);
  if (json === lastSaved) return;
  lastSaved = json;
  try {
    localStorage.setItem(STORAGE_KEY, json);
  } catch {
    // Storage full (large picture) or blocked: settings still apply this session.
  }
});

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    const next = load();
    lastSaved = snapshot(next);
    useNowPlayingStore.setState(next);
  });
}
