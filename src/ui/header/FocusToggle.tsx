import { getCurrentWindow } from '@tauri-apps/api/window';
import { Maximize, Minimize } from 'lucide-react';
import { useEffect } from 'react';
import { inTauri } from '../../platform/window';
import { updateAppPrefs, useAppPrefsStore } from '../../state/appPrefsStore';

/** Fullscreen covers the Windows taskbar; in a plain browser, the Fullscreen API stands in. */
const applyFocus = async (on: boolean): Promise<void> => {
  if (inTauri()) {
    await getCurrentWindow().setFullscreen(on);
    return;
  }
  if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
  if (!on && document.fullscreenElement) await document.exitFullscreen();
};

export const setFocusView = (on: boolean): void => {
  updateAppPrefs({ focus: on });
  void applyFocus(on).catch(() => updateAppPrefs({ focus: !on }));
};

/**
 * Restores focus view on launch, keeps the toggle in sync if fullscreen ends
 * some other way, and binds F11.
 */
export const useFocusView = (): void => {
  useEffect(() => {
    if (inTauri() && useAppPrefsStore.getState().focus) void applyFocus(true).catch(() => undefined);

    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'F11' || e.defaultPrevented) return;
      e.preventDefault();
      setFocusView(!useAppPrefsStore.getState().focus);
    };
    window.addEventListener('keydown', onKey);

    let stop: (() => void) | null = null;
    let live = true;
    if (inTauri()) {
      const win = getCurrentWindow();
      void win
        .onResized(() => {
          void win.isFullscreen().then((fs) => {
            if (fs !== useAppPrefsStore.getState().focus) updateAppPrefs({ focus: fs });
          });
        })
        .then((un) => (live ? (stop = un) : un()));
    } else {
      const onFs = (): void => updateAppPrefs({ focus: document.fullscreenElement !== null });
      document.addEventListener('fullscreenchange', onFs);
      stop = () => document.removeEventListener('fullscreenchange', onFs);
    }
    return () => {
      live = false;
      window.removeEventListener('keydown', onKey);
      stop?.();
    };
  }, []);
};

export function FocusToggle() {
  const focus = useAppPrefsStore((s) => s.focus);
  const Icon = focus ? Minimize : Maximize;
  return (
    <button
      type="button"
      onClick={() => setFocusView(!focus)}
      aria-pressed={focus}
      aria-label={focus ? 'Exit focus view' : 'Focus view'}
      title={focus ? 'Exit focus view (F11)' : 'Focus view: fill the whole screen, over the taskbar (F11)'}
      className="rounded-md p-1.5 text-slate-400 hover:bg-panel-hi hover:text-slate-100"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
