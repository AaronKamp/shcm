import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useViewStore } from '../state/viewStore';

/** Event emitted by src-tauri when a window is hidden to tray, minimized, or shown. */
export const VISIBILITY_EVENT = 'shcm://visibility';

/** Must match `VisibilityPayload` in src-tauri/src/desktop.rs. */
interface VisibilityPayload {
  readonly label: string;
  readonly visible: boolean;
}

export type AppView = 'dashboard' | 'overlay';

export const inTauri = (): boolean => isTauri();

/** Which UI this window renders: Tauri window label first, `?view=` for plain browsers. */
export const resolveView = (): AppView => {
  if (inTauri() && getCurrentWindow().label === 'overlay') return 'overlay';
  return new URLSearchParams(window.location.search).get('view') === 'overlay' ? 'overlay' : 'dashboard';
};

/**
 * Feeds both visibility signals into the view store. WebView2 does not reliably
 * flip `document.visibilityState` on `window.hide()`, so the native side also
 * emits explicit events from the tray / minimize handlers.
 */
export const installVisibilityTracking = async (): Promise<() => void> => {
  const { setDocumentVisible, setWindowVisible } = useViewStore.getState();
  const onDoc = (): void => setDocumentVisible(document.visibilityState === 'visible');
  document.addEventListener('visibilitychange', onDoc);
  onDoc();

  let unlisten: (() => void) | null = null;
  if (inTauri()) {
    const win = getCurrentWindow();
    const [visible, minimized] = await Promise.all([win.isVisible(), win.isMinimized()]);
    setWindowVisible(visible && !minimized);
    unlisten = await listen<VisibilityPayload>(VISIBILITY_EVENT, (e) => {
      if (e.payload.label === win.label) setWindowVisible(e.payload.visible);
    });
  }
  return () => {
    document.removeEventListener('visibilitychange', onDoc);
    unlisten?.();
  };
};

/** Hides this window (overlay dismiss). Streams pause before the native hide. */
export const hideCurrentWindow = async (): Promise<void> => {
  useViewStore.getState().setWindowVisible(false);
  if (inTauri()) await getCurrentWindow().hide();
};
