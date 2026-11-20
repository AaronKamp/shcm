import { create } from 'zustand';

export type TimerKind = 'timer' | 'reminder';

export interface VoiceTimer {
  readonly id: string;
  readonly label: string;
  readonly kind: TimerKind;
  /** Epoch ms when it goes off. */
  readonly dueAt: number;
}

interface TimerState {
  /** Pending timers, shared by every window through localStorage. */
  readonly timers: readonly VoiceTimer[];
  /** Gone off in this window and not yet dismissed. */
  readonly ringing: readonly VoiceTimer[];
}

const KEY = 'shcm.timers.v1';

const isTimer = (v: unknown): v is VoiceTimer => {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Record<string, unknown>;
  return typeof t['id'] === 'string' && typeof t['label'] === 'string' && (t['kind'] === 'timer' || t['kind'] === 'reminder') && typeof t['dueAt'] === 'number';
};

const load = (): VoiceTimer[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isTimer) : [];
  } catch {
    return [];
  }
};

const save = (timers: readonly VoiceTimer[]): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(timers));
  } catch {
    // Storage blocked: timers still work in this window until it closes.
  }
};

export const useTimerStore = create<TimerState>(() => ({ timers: load(), ringing: [] }));

const setTimers = (timers: readonly VoiceTimer[]): void => {
  const sorted = [...timers].sort((a, b) => a.dueAt - b.dueAt);
  save(sorted);
  useTimerStore.setState({ timers: sorted });
};

export const addTimer = (label: string, kind: TimerKind, dueAt: number): VoiceTimer => {
  const timer: VoiceTimer = { id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, label, kind, dueAt };
  setTimers([...load(), timer]);
  return timer;
};

/** Cancels by id, by label (case-insensitive substring), or everything for "all". */
export const cancelTimers = (match: string): VoiceTimer[] => {
  const q = match.trim().toLowerCase();
  const all = load();
  const hit = (t: VoiceTimer): boolean => q === 'all' || t.id === match || (q !== '' && t.label.toLowerCase().includes(q));
  const gone = all.filter(hit);
  if (gone.length) setTimers(all.filter((t) => !hit(t)));
  return gone;
};

export const dismissRinging = (id: string): void =>
  useTimerStore.setState((s) => ({ ringing: s.ringing.filter((t) => t.id !== id) }));

/**
 * Removes a due timer from shared storage and reports whether this window got
 * it first (so two open windows don't both ring).
 */
export const claimDue = (id: string): VoiceTimer | undefined => {
  const all = load();
  const timer = all.find((t) => t.id === id);
  if (!timer) {
    useTimerStore.setState({ timers: all });
    return undefined;
  }
  setTimers(all.filter((t) => t.id !== id));
  useTimerStore.setState((s) => ({ ringing: [...s.ringing, timer] }));
  return timer;
};

// Another window added or cancelled a timer.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) useTimerStore.setState({ timers: load() });
  });
}
