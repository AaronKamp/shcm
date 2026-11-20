import { create } from 'zustand';

/**
 * Which music apps can play on a speaker, keyed by the speaker card's uid.
 * Spotify is one account-wide player whose "sources" are Spotify Connect
 * devices, so a link names that player plus this speaker's device name.
 * Music Assistant creates its own player per speaker, so a link names that one.
 */
export interface MediaApps {
  readonly spotify?: { readonly playerUid: string; readonly device: string };
  readonly musicAssistant?: { readonly playerUid: string };
}

interface MediaAppState {
  readonly links: Readonly<Record<string, MediaApps>>;
  setLinks: (speakerUid: string, apps: MediaApps | null) => void;
}

const STORAGE_KEY = 'shcm.mediaApps.v1';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Defensive parse: drops anything malformed instead of failing the whole load. */
const parseApps = (v: unknown): MediaApps | null => {
  if (!isObj(v)) return null;
  const out: { spotify?: MediaApps['spotify']; musicAssistant?: MediaApps['musicAssistant'] } = {};
  const s = v['spotify'];
  if (isObj(s) && typeof s['playerUid'] === 'string' && typeof s['device'] === 'string') out.spotify = { playerUid: s['playerUid'], device: s['device'] };
  const m = v['musicAssistant'];
  if (isObj(m) && typeof m['playerUid'] === 'string') out.musicAssistant = { playerUid: m['playerUid'] };
  return out.spotify || out.musicAssistant ? out : null;
};

const load = (): Record<string, MediaApps> => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!isObj(raw)) return {};
    const out: Record<string, MediaApps> = {};
    for (const [uid, v] of Object.entries(raw)) {
      const apps = parseApps(v);
      if (apps) out[uid] = apps;
    }
    return out;
  } catch {
    return {};
  }
};

export const useMediaAppStore = create<MediaAppState>()((set) => ({
  links: load(),
  setLinks: (speakerUid, apps) =>
    set((s) => {
      const links = { ...s.links };
      if (apps && (apps.spotify || apps.musicAssistant)) links[speakerUid] = apps;
      else delete links[speakerUid];
      return { links };
    }),
}));

let lastSaved = JSON.stringify(useMediaAppStore.getState().links);
useMediaAppStore.subscribe((s) => {
  const json = JSON.stringify(s.links);
  if (json === lastSaved) return;
  lastSaved = json;
  try {
    localStorage.setItem(STORAGE_KEY, json);
  } catch {
    // Storage full or blocked: links still work for this session.
  }
});

// Keep the dashboard and overlay windows in step.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    const links = load();
    lastSaved = JSON.stringify(links);
    useMediaAppStore.setState({ links });
  });
}
