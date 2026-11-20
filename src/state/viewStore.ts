import { create } from 'zustand';
import { useScreensaverStore } from './screensaverStore';

/** Mirrors the `control_camera_view` Gemini tool enum. */
export type CameraViewMode = 'pip_overlay' | 'fullscreen' | 'grid' | 'close';

export interface PipWindow {
  readonly uid: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly z: number;
}

interface ViewState {
  readonly pips: readonly PipWindow[];
  readonly fullscreenUid: string | null;
  /** `document.visibilityState` (tab hidden, OS minimize in some WebViews). */
  readonly documentVisible: boolean;
  /** Native window shown (driven by Tauri tray/minimize events). */
  readonly windowVisible: boolean;

  openPip: (uid: string) => void;
  closePip: (uid: string) => void;
  movePip: (uid: string, x: number, y: number) => void;
  resizePip: (uid: string, width: number) => void;
  focusPip: (uid: string) => void;
  setFullscreen: (uid: string | null) => void;
  applyCameraView: (uid: string, mode: CameraViewMode) => void;
  setDocumentVisible: (visible: boolean) => void;
  setWindowVisible: (visible: boolean) => void;
}

export const MAX_PIPS = 4;
export const PIP_MIN_WIDTH = 240;
const PIP_DEFAULT_WIDTH = 360;

let zCounter = 10;

export const useViewStore = create<ViewState>()((set, get) => ({
  pips: [],
  fullscreenUid: null,
  documentVisible: typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  windowVisible: true,

  openPip: (uid) => {
    const { pips } = get();
    if (pips.some((p) => p.uid === uid)) return get().focusPip(uid);
    const offset = pips.length * 32;
    const width = Math.min(PIP_DEFAULT_WIDTH, Math.max(PIP_MIN_WIDTH, window.innerWidth - 32));
    const x = Math.max(16, window.innerWidth - width - 24 - offset);
    const y = Math.max(16, window.innerHeight - (width * 9) / 16 - 64 - offset);
    // Oldest popup is evicted when the cap is reached.
    const kept = pips.length >= MAX_PIPS ? pips.slice(1) : pips;
    set({ pips: [...kept, { uid, x, y, width, z: ++zCounter }] });
  },
  closePip: (uid) => set({ pips: get().pips.filter((p) => p.uid !== uid) }),
  movePip: (uid, x, y) => set({ pips: get().pips.map((p) => (p.uid === uid ? { ...p, x, y } : p)) }),
  resizePip: (uid, width) =>
    set({ pips: get().pips.map((p) => (p.uid === uid ? { ...p, width: Math.max(PIP_MIN_WIDTH, width) } : p)) }),
  focusPip: (uid) => set({ pips: get().pips.map((p) => (p.uid === uid ? { ...p, z: ++zCounter } : p)) }),
  setFullscreen: (uid) => set({ fullscreenUid: uid }),

  applyCameraView: (uid, mode) => {
    switch (mode) {
      case 'pip_overlay':
        get().openPip(uid);
        break;
      case 'fullscreen':
        set({ fullscreenUid: uid });
        break;
      case 'grid':
        set({ fullscreenUid: null, pips: get().pips.filter((p) => p.uid !== uid) });
        break;
      case 'close':
        set({
          fullscreenUid: get().fullscreenUid === uid ? null : get().fullscreenUid,
          pips: get().pips.filter((p) => p.uid !== uid),
        });
        break;
    }
  },

  setDocumentVisible: (documentVisible) => set({ documentVisible }),
  setWindowVisible: (windowVisible) => set({ windowVisible }),
}));

/** True only when the user can actually see this window. Video tiles key off this. */
export const useAppVisible = (): boolean => {
  const visible = useViewStore((s) => s.documentVisible && s.windowVisible);
  // The screensaver covers the dashboard: camera streams pause under it.
  const covered = useScreensaverStore((s) => s.active);
  return visible && !covered;
};
