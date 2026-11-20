import { Keyboard } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage } from '../core/DeviceProvider';
import { eventToAccelerator, useShortcutStore, type ShortcutAction } from '../state/shortcutStore';

const ROWS: readonly { readonly action: ShortcutAction; readonly label: string; readonly hint: string }[] = [
  { action: 'overlay', label: 'Show / hide overlay', hint: 'Works from any app' },
  { action: 'ptt', label: 'Talk (hold)', hint: 'Hold to speak to the assistant' },
];

/** Global keyboard shortcuts, each changeable by pressing a new combination. */
export function ShortcutSettings() {
  const shortcuts = useShortcutStore();
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      // Capture phase + stop: Escape here cancels recording instead of closing Settings.
      e.stopImmediatePropagation();
      if (e.key === 'Escape') return setRecording(null);
      const accel = eventToAccelerator(e);
      if (!accel) return; // still holding modifiers, or an unsupported key
      setRecording(null);
      shortcuts.setShortcut(recording, accel).catch((err: unknown) => setError(errorMessage(err)));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, shortcuts]);

  return (
    <section className="mb-4 rounded-xl border border-line bg-panel p-3" aria-label="Keyboard shortcuts">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
        <Keyboard className="h-4 w-4 text-slate-400" aria-hidden /> Keyboard shortcuts
      </h3>
      {ROWS.map(({ action, label, hint }) => (
        <div key={action} className="flex items-center gap-2 py-1.5">
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-slate-200">{label}</span>
            <span className="block text-xs text-slate-500">{hint}</span>
          </span>
          <kbd className={`rounded px-2 py-1 text-xs ${recording === action ? 'bg-accent/20 text-accent' : 'bg-panel-hi text-slate-200'}`}>
            {recording === action ? 'Press keys…' : shortcuts[action]}
          </kbd>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setRecording(recording === action ? null : action);
            }}
            className="rounded-md border border-line px-2 py-1 text-xs text-slate-300 hover:bg-panel-hi"
          >
            {recording === action ? 'Cancel' : 'Change'}
          </button>
        </div>
      ))}
      <p className="mt-1 text-xs text-slate-500">Use Ctrl, Alt, Shift or Win with a letter, number, Space or F-key. Esc cancels.</p>
      {error && <p className="mt-1 text-xs text-bad">{error}</p>}
    </section>
  );
}
