import { useMemo } from 'react';
import { create } from 'zustand';
import type { SmartEntity } from '../core/types';
import {
  loadLayout,
  saveLayout,
  serializeLayout,
  SPAN_MAX,
  SPAN_MIN,
  STORAGE_KEY,
  type GroupScope,
  type PersistedLayout,
  type TileGroup,
} from './layoutPersist';

/**
 * User layout: dashboard tile order, camera tile widths, hidden tiles, renames,
 * switches treated as lights, and the named groups for the dashboard and the
 * overlay. Persisted to localStorage, which both windows share (same origin),
 * so edits made in one window show up in the other via the `storage` event.
 */

export { SPAN_MAX, SPAN_MIN } from './layoutPersist';
export type { GroupCameraView, GroupScope, GroupWidth, TileGroup } from './layoutPersist';
export type OverlayGroup = TileGroup;

type GroupPatch = Partial<Omit<TileGroup, 'id'>>;

interface LayoutState extends PersistedLayout {
  /** Dashboard edit mode (per window, not persisted). */
  readonly editing: boolean;
  readonly selected: ReadonlySet<string>;

  setEditing: (editing: boolean) => void;
  toggleSelected: (uid: string) => void;
  clearSelection: () => void;
  /** Writes `sectionIds` (already reordered) into the global order. */
  reorder: (sectionIds: readonly string[]) => void;
  setSpan: (uid: string, span: number | null) => void;
  /** null or blank restores the provider's name. */
  setName: (uid: string, name: string | null) => void;
  /** Flips whether a switch counts as a light; `isLight` is its current status. */
  toggleLightSwitch: (uid: string, isLight: boolean) => void;
  hide: (uids: readonly string[]) => void;
  unhide: (uids: readonly string[]) => void;
  addGroup: (scope: GroupScope, name: string, items?: readonly string[]) => string;
  updateGroup: (scope: GroupScope, id: string, patch: GroupPatch) => void;
  removeGroup: (scope: GroupScope, id: string) => void;
  moveGroup: (scope: GroupScope, id: string, delta: -1 | 1) => void;
  addToGroup: (scope: GroupScope, id: string, uids: readonly string[]) => void;
  /** Takes the tiles out of every group of that scope. */
  ungroup: (scope: GroupScope, uids: readonly string[]) => void;
  resetOverlay: () => void;
}

const newId = (): string => `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const useLayoutStore = create<LayoutState>()((set, get) => {
  const groupsOf = (scope: GroupScope): readonly TileGroup[] =>
    (scope === 'dashboard' ? get().dashboardGroups : get().overlayGroups) ?? [];
  const setGroups = (scope: GroupScope, groups: readonly TileGroup[]): void =>
    set(scope === 'dashboard' ? { dashboardGroups: groups } : { overlayGroups: groups });
  const mapGroup = (scope: GroupScope, id: string, fn: (g: TileGroup) => TileGroup): void =>
    setGroups(scope, groupsOf(scope).map((g) => (g.id === id ? fn(g) : g)));
  /** Dashboard tiles live in one group at a time; overlay tiles may repeat. */
  const without = (scope: GroupScope, uids: readonly string[]): readonly TileGroup[] => {
    const drop = new Set(uids);
    return groupsOf(scope).map((g) => (g.items.some((u) => drop.has(u)) ? { ...g, items: g.items.filter((u) => !drop.has(u)) } : g));
  };

  return {
    ...loadLayout(),
    editing: false,
    selected: new Set<string>(),

    setEditing: (editing) => set(editing ? { editing } : { editing, selected: new Set() }),
    toggleSelected: (uid) => {
      const selected = new Set(get().selected);
      if (!selected.delete(uid)) selected.add(uid);
      set({ selected });
    },
    clearSelection: () => set({ selected: new Set() }),

    reorder: (sectionIds) => {
      const inSection = new Set(sectionIds);
      set({ order: [...sectionIds, ...get().order.filter((u) => !inSection.has(u))] });
    },
    setSpan: (uid, span) => {
      const spans = { ...get().spans };
      if (span === null) delete spans[uid];
      else spans[uid] = Math.min(SPAN_MAX, Math.max(SPAN_MIN, Math.round(span)));
      set({ spans });
    },
    setName: (uid, name) => {
      const names = { ...get().names };
      const trimmed = name?.trim();
      if (trimmed) names[uid] = trimmed;
      else delete names[uid];
      set({ names });
    },
    toggleLightSwitch: (uid, isLight) => {
      const { lightSwitches, notLightSwitches } = get();
      // An explicit choice either way overrides the name-based guess.
      set(
        isLight
          ? { lightSwitches: lightSwitches.filter((u) => u !== uid), notLightSwitches: [...new Set([...notLightSwitches, uid])] }
          : { lightSwitches: [...new Set([...lightSwitches, uid])], notLightSwitches: notLightSwitches.filter((u) => u !== uid) },
      );
    },
    hide: (uids) => set({ hidden: [...new Set([...get().hidden, ...uids])], selected: new Set() }),
    unhide: (uids) => {
      const show = new Set(uids);
      set({ hidden: get().hidden.filter((u) => !show.has(u)) });
    },

    addGroup: (scope, name, items = []) => {
      const id = newId();
      const base = scope === 'dashboard' ? without(scope, items) : groupsOf(scope);
      setGroups(scope, [...base, { id, name, items: [...new Set(items)], cameraView: 'live', width: 'full' }]);
      return id;
    },
    updateGroup: (scope, id, patch) => mapGroup(scope, id, (g) => ({ ...g, ...patch })),
    removeGroup: (scope, id) => setGroups(scope, groupsOf(scope).filter((g) => g.id !== id)),
    moveGroup: (scope, id, delta) => {
      const groups = [...groupsOf(scope)];
      const i = groups.findIndex((g) => g.id === id);
      const j = i + delta;
      const g = groups[i];
      if (i < 0 || j < 0 || j >= groups.length || !g) return;
      groups.splice(i, 1);
      groups.splice(j, 0, g);
      setGroups(scope, groups);
    },
    addToGroup: (scope, id, uids) => {
      const base = scope === 'dashboard' ? without(scope, uids) : groupsOf(scope);
      setGroups(scope, base.map((g) => (g.id === id ? { ...g, items: [...new Set([...g.items, ...uids])] } : g)));
    },
    ungroup: (scope, uids) => setGroups(scope, without(scope, uids)),
    resetOverlay: () => set({ overlayGroups: null }),
  };
});

/** Applies the user's display name, if any. Returns the same object when unchanged. */
export const withName = <T extends { readonly uid: string; name: string }>(item: T, names: Readonly<Record<string, string>>): T => {
  const name = names[item.uid];
  return name && name !== item.name ? { ...item, name } : item;
};

const LIGHT_WORDS = /\b(lights?|lamps?|lanterns?|sconces?|chandeliers?|bulbs?)\b/i;

/** A switch whose name (yours or Home Assistant's) says it runs a light, e.g. "Closet Lights". */
const namedLikeLight = (e: SmartEntity): boolean => {
  const ha = e.attributes['friendly_name'];
  return LIGHT_WORDS.test(e.name) || (typeof ha === 'string' && LIGHT_WORDS.test(ha));
};

export interface LightSwitchPrefs {
  readonly lightSwitches: readonly string[];
  readonly notLightSwitches: readonly string[];
}

/**
 * Real lights, plus switches that run lights: ones the user marked, or whose
 * name says light, unless the user un-marked them.
 */
export const isLightLike = (e: SmartEntity, prefs: LightSwitchPrefs): boolean =>
  e.domain === 'light' ||
  (e.domain === 'switch' && !prefs.notLightSwitches.includes(e.uid) && (prefs.lightSwitches.includes(e.uid) || namedLikeLight(e)));

/** The layout's light-switch choices, for `isLightLike`. */
export const useLightSwitchPrefs = (): LightSwitchPrefs => {
  const lightSwitches = useLayoutStore((s) => s.lightSwitches);
  const notLightSwitches = useLayoutStore((s) => s.notLightSwitches);
  return useMemo(() => ({ lightSwitches, notLightSwitches }), [lightSwitches, notLightSwitches]);
};

/** Sorts `items` by the saved order; items not in it keep their relative order at the end. */
export const applyOrder = <T extends { readonly uid: string }>(items: readonly T[], order: readonly string[]): T[] => {
  const rank = new Map(order.map((u, i) => [u, i]));
  return items
    .map((item, i) => ({ item, r: rank.get(item.uid) ?? order.length + i }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.item);
};

let lastSaved = serializeLayout(useLayoutStore.getState());
useLayoutStore.subscribe((s) => {
  const json = serializeLayout(s);
  if (json === lastSaved) return;
  lastSaved = json;
  saveLayout(json);
});

// Another window (dashboard ↔ overlay) changed the layout.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    const p = loadLayout();
    lastSaved = serializeLayout(p);
    useLayoutStore.setState(p);
  });
}
