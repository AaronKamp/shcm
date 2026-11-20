import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';
import { isRecord, str } from '../core/json';
import { inTauri } from '../platform/window';

/** Emitted by src-tauri/src/shortcuts.rs when a shortcut changes. */
const SHORTCUTS_EVENT = 'shcm://shortcuts';

export type ShortcutAction = 'overlay' | 'ptt';

interface ShortcutState {
  /** Accelerators as shown, e.g. "Ctrl+Shift+Space". */
  readonly overlay: string;
  readonly ptt: string;
  /** Rebinds globally; rejects with a readable reason (combo taken, unsupported…). */
  setShortcut: (action: ShortcutAction, accelerator: string) => Promise<void>;
}

const DEFAULTS = { overlay: 'Ctrl+Shift+Space', ptt: 'Ctrl+Alt+Space' } as const;

const parse = (v: unknown): { overlay: string; ptt: string } | null =>
  isRecord(v) && str(v['overlay']) && str(v['ptt']) ? { overlay: str(v['overlay']), ptt: str(v['ptt']) } : null;

export const useShortcutStore = create<ShortcutState>()((set) => ({
  ...DEFAULTS,
  setShortcut: async (action, accelerator) => {
    const next = parse(await invoke<unknown>('set_shortcut', { action, accelerator }));
    if (next) set(next);
  },
}));

if (inTauri()) {
  void invoke<unknown>('get_shortcuts')
    .then((v) => {
      const s = parse(v);
      if (s) useShortcutStore.setState(s);
    })
    .catch(() => undefined);
  void listen<unknown>(SHORTCUTS_EVENT, (e) => {
    const s = parse(e.payload);
    if (s) useShortcutStore.setState(s);
  });
}

/** Does this key event match an accelerator like "Ctrl+Alt+Space"? */
export const matchesAccelerator = (e: KeyboardEvent, accelerator: string): boolean => {
  const parts = accelerator.split('+').map((p) => p.trim().toLowerCase());
  const key = parts[parts.length - 1] ?? '';
  const want = (m: string): boolean => parts.includes(m);
  const code = e.code.toLowerCase();
  const keyOk = code === key || code === `key${key}` || code === `digit${key}`;
  return keyOk && e.ctrlKey === want('ctrl') && e.altKey === want('alt') && e.shiftKey === want('shift') && e.metaKey === (want('super') || want('cmd'));
};

/** Modifier `key` values of an accelerator, so releasing any of them ends hold-to-talk. */
export const acceleratorKeys = (accelerator: string): string[] =>
  accelerator.split('+').map((p) => ({ ctrl: 'Control', alt: 'Alt', shift: 'Shift', super: 'Meta', cmd: 'Meta' })[p.trim().toLowerCase()] ?? p.trim());

/**
 * A key event as an accelerator ("Ctrl+Shift+K"), or null if it's not a usable
 * combo: needs at least one modifier plus a letter, digit, Space or F-key.
 */
export const eventToAccelerator = (e: KeyboardEvent): string | null => {
  const key = /^Key([A-Z])$/.exec(e.code)?.[1] ?? /^Digit(\d)$/.exec(e.code)?.[1] ?? (/^(Space|F\d{1,2})$/.test(e.code) ? e.code : null);
  if (!key) return null;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter((m): m is string => Boolean(m));
  return mods.length ? [...mods, key].join('+') : null;
};
