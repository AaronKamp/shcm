import { claimDue, useTimerStore, type VoiceTimer } from '../../state/timerStore';

/** A hidden window waits this long so the visible one (not throttled) rings first. */
const HIDDEN_GRACE_MS = 3000;
const REPEAT_CHIMES_MS = [15_000, 30_000];

let ctx: AudioContext | null = null;

/** Three soft rising tones. */
const chime = (): void => {
  try {
    ctx ??= new AudioContext();
    const t0 = ctx.currentTime + 0.05;
    [660, 880, 1100].forEach((hz, i) => {
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = hz;
      const t = t0 + i * 0.22;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.55);
    });
  } catch {
    // No audio device: the on-screen alert still shows.
  }
};

const speak = (text: string): void => {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    window.speechSynthesis.speak(u);
  } catch {
    // Speech unavailable: chime + banner only.
  }
};

export const announcement = (t: VoiceTimer): string =>
  t.kind === 'reminder' ? `Reminder: ${t.label}.` : `Your ${t.label} timer is done.`;

const ring = (t: VoiceTimer): void => {
  chime();
  setTimeout(() => speak(announcement(t)), 900);
  for (const ms of REPEAT_CHIMES_MS) {
    setTimeout(() => {
      if (useTimerStore.getState().ringing.some((r) => r.id === t.id)) chime();
    }, ms);
  }
};

let started = false;

/** Checks every second for due timers; safe to call from every window. */
export const startTimerClock = (): void => {
  if (started) return;
  started = true;
  setInterval(() => {
    const now = Date.now();
    const grace = document.visibilityState === 'visible' ? 0 : HIDDEN_GRACE_MS;
    for (const t of useTimerStore.getState().timers) {
      if (t.dueAt + grace > now) continue;
      const won = claimDue(t.id);
      if (won) ring(won);
    }
  }, 1000);
};
