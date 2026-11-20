import { BellRing, Timer, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cancelTimers, dismissRinging, useTimerStore } from '../../state/timerStore';
import { startTimerClock } from './timerClock';

const remaining = (dueAt: number, now: number): string => {
  const s = Math.max(0, Math.round((dueAt - now) / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const clock = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Voice timers and reminders: countdowns plus alerts that have gone off. */
export function TimerTray({ compact = false }: { compact?: boolean }) {
  const timers = useTimerStore((s) => s.timers);
  const ringing = useTimerStore((s) => s.ringing);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => startTimerClock(), []);
  useEffect(() => {
    if (timers.length === 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timers.length]);

  if (timers.length === 0 && ringing.length === 0) return null;
  return (
    // Bottom-left: the voice button owns the bottom-right corner.
    <div className={`fixed z-50 flex flex-col items-start gap-2 ${compact ? 'bottom-2 left-2' : 'bottom-4 left-4'}`} aria-live="polite">
      {ringing.map((t) => (
        <div key={t.id} role="alert" className="flex items-center gap-3 rounded-xl border border-accent bg-panel px-4 py-3 shadow-xl">
          <BellRing className="h-5 w-5 animate-pulse text-accent" aria-hidden />
          <span className="text-sm text-slate-100">
            <span className="block text-xs uppercase tracking-wider text-slate-400">{t.kind === 'reminder' ? 'Reminder' : 'Timer done'}</span>
            {t.label}
          </span>
          <button type="button" onClick={() => dismissRinging(t.id)} className="ml-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/80">
            Dismiss
          </button>
        </div>
      ))}
      {timers.map((t) => (
        <div key={t.id} className="flex items-center gap-2 rounded-full border border-line bg-panel/95 py-1 pl-3 pr-1 text-xs text-slate-200 shadow">
          <Timer className="h-3.5 w-3.5 text-accent" aria-hidden />
          <span className="max-w-40 truncate">{t.label}</span>
          <span className="tabular-nums text-slate-400">{t.kind === 'reminder' ? clock(t.dueAt) : remaining(t.dueAt, now)}</span>
          <button type="button" onClick={() => cancelTimers(t.id)} aria-label={`Cancel ${t.label}`} className="rounded-full p-1 text-slate-400 hover:bg-panel-hi hover:text-white">
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
