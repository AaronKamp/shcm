import { AudioLines } from 'lucide-react';
import { setWakeEnabled, useWakeStore, type WakeStatus } from '../state/wakeStore';

const STATUS: Record<WakeStatus, string> = {
  off: 'Off',
  starting: 'Starting…',
  listening: 'Listening for “Hey Jarvis”',
  error: 'Not listening',
};

/** On/off for the always-on wake word, with the detector's live state. */
export function WakeWordSettings() {
  const enabled = useWakeStore((s) => s.enabled);
  const status = useWakeStore((s) => s.status);
  const error = useWakeStore((s) => s.error);

  return (
    <section className="mb-4 rounded-xl border border-line bg-panel p-3" aria-label="Wake word">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <AudioLines className="h-4 w-4 text-slate-400" aria-hidden /> Wake word
          </span>
          <span className={`block text-xs ${status === 'error' ? 'text-bad' : 'text-slate-500'}`}>
            {STATUS[status]}
            {error ? `: ${error}` : ''}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Listen for “Hey Jarvis”"
          onClick={() => setWakeEnabled(!enabled)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? 'bg-accent' : 'bg-panel-hi'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${enabled ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Say “Hey Jarvis” to start hands-free voice, even with the app hidden to the tray. Detection runs on this PC; nothing is sent until the
        wake word is heard.
      </p>
    </section>
  );
}
