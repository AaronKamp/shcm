import { errorMessage } from '../core/DeviceProvider';
import { isRecord, str } from '../core/json';
import type { ProviderRegistry } from '../core/ProviderRegistry';
import type { JsonObject, JsonValue } from '../core/types';
import { addTimer, cancelTimers, useTimerStore, type TimerKind } from '../state/timerStore';

const fail = (error: string): JsonObject => ({ ok: false, error });
const MAX_TIMER_S = 7 * 24 * 3600;

const localTime = (ms: number): string =>
  new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

/** "17:30" / "5:30" → next occurrence today or tomorrow; anything else via Date.parse. */
const parseAt = (at: string, now: number): number | undefined => {
  const hm = /^(\d{1,2}):(\d{2})$/.exec(at.trim());
  if (hm) {
    const d = new Date(now);
    d.setHours(Number(hm[1]), Number(hm[2]), 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  const t = Date.parse(at);
  return Number.isFinite(t) ? t : undefined;
};

/** manage_timer: set / cancel / list timers and reminders that ring in SHCM. */
export const manageTimer = (args: JsonObject): JsonObject => {
  const action = str(args['action']);
  const now = Date.now();
  if (action === 'list') {
    const timers: JsonValue[] = useTimerStore.getState().timers.map((t) => ({
      id: t.id,
      label: t.label,
      kind: t.kind,
      due: localTime(t.dueAt),
      remaining_seconds: Math.max(0, Math.round((t.dueAt - now) / 1000)),
    }));
    return { ok: true, now: localTime(now), timers };
  }
  if (action === 'cancel') {
    const gone = cancelTimers(str(args['label']) || 'all');
    return gone.length ? { ok: true, cancelled: gone.map((t) => t.label) } : fail('No matching timer or reminder');
  }
  if (action !== 'set') return fail('action must be set, cancel or list');

  const kind: TimerKind = str(args['kind']) === 'reminder' ? 'reminder' : 'timer';
  const seconds = typeof args['duration_seconds'] === 'number' ? args['duration_seconds'] : NaN;
  const at = str(args['at']);
  const dueAt = at ? parseAt(at, now) : Number.isFinite(seconds) ? now + seconds * 1000 : undefined;
  if (dueAt === undefined) return fail('Give duration_seconds or at (e.g. "17:30")');
  if (dueAt <= now) return fail('That time has already passed');
  if (dueAt - now > MAX_TIMER_S * 1000) return fail('Timers and reminders can be at most 7 days out');
  const label = str(args['label']).trim() || (kind === 'reminder' ? 'Reminder' : 'Timer');
  const t = addTimer(label, kind, dueAt);
  return { ok: true, id: t.id, label: t.label, kind, due: localTime(dueAt), in_seconds: Math.round((dueAt - now) / 1000) };
};

/** Every `text` / `response` string in Google Assistant's reply, in order. */
const replyTexts = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) for (const x of v) replyTexts(x, out);
  else if (isRecord(v)) {
    for (const [k, x] of Object.entries(v)) {
      if ((k === 'text' || k === 'response') && typeof x === 'string' && x.trim()) out.push(x.trim());
      else replyTexts(x, out);
    }
  }
  return out;
};

/** ask_google_home: a typed command to Google Home through HA's Google Assistant SDK integration. */
export const askGoogleHome = async (args: JsonObject, registry: ProviderRegistry): Promise<JsonObject> => {
  const command = str(args['command']).trim();
  if (!command) return fail('command is required');
  try {
    const reply = replyTexts(await registry.askAssistant(command)).join(' ');
    return reply
      ? { ok: true, command, google_reply: reply }
      : { ok: true, command, google_reply: null, note: 'Sent, but Google gave no reply, so the result is unconfirmed.' };
  } catch (err: unknown) {
    const msg = errorMessage(err);
    if (/not found|unknown service|google_assistant_sdk/i.test(msg)) {
      return fail("Google Home isn't linked: Home Assistant's Google Assistant SDK integration isn't set up.");
    }
    return fail(msg);
  }
};
