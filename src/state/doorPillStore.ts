import { create } from 'zustand';

interface DoorPillPrefs {
  /** Entity uids to show as header pills, in order. `null`: pick automatically. */
  readonly custom: readonly string[] | null;
}

const KEY = 'shcm.doorPills.v1';

const load = (): DoorPillPrefs => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return { custom: null };
    const list = (raw as Record<string, unknown>)['custom'];
    if (!Array.isArray(list)) return { custom: null };
    return { custom: list.filter((v): v is string => typeof v === 'string').slice(0, 50) };
  } catch {
    return { custom: null };
  }
};

export const useDoorPillStore = create<DoorPillPrefs>()(() => load());

export const setDoorPills = (custom: readonly string[] | null): void => {
  useDoorPillStore.setState({ custom });
  try {
    localStorage.setItem(KEY, JSON.stringify({ custom }));
  } catch {
    // Storage blocked: applies until restart.
  }
};
