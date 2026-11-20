import { isRecord, parseJson, str } from '../core/json';

/**
 * Saved shape of the user's layout and its (defensive) localStorage codec.
 * Both windows share the storage, so this is also how they sync.
 */

export type GroupCameraView = 'live' | 'chips';
/** Which surface a group belongs to. */
export type GroupScope = 'dashboard' | 'overlay';
export type GroupWidth = 'full' | 'twothirds' | 'half' | 'third';

/** Built-in dashboard group that holds the Now Playing card (no tiles); moves and resizes like any group. */
export const NOW_PLAYING_GROUP = 'now_playing';
export const isWidgetGroup = (g: { readonly id: string }): boolean => g.id === NOW_PLAYING_GROUP;
const NOW_PLAYING: TileGroup = { id: NOW_PLAYING_GROUP, name: 'Now Playing', items: [], cameraView: 'live', width: 'full' };

/** Puts the Now Playing group first when the saved layout predates it. */
const withWidgets = (groups: readonly TileGroup[]): TileGroup[] =>
  groups.some(isWidgetGroup) ? groups.map((g) => (isWidgetGroup(g) ? { ...g, items: [] } : g)) : [NOW_PLAYING, ...groups];

export interface TileGroup {
  readonly id: string;
  readonly name: string;
  /** Camera and entity uids. Overlay groups display in this order. */
  readonly items: readonly string[];
  /** Overlay only: cameras as live video tiles, or as chips that open a popup. */
  readonly cameraView: GroupCameraView;
  /** Dashboard only: share a row with neighbouring groups on wide windows. */
  readonly width: GroupWidth;
}

export interface PersistedLayout {
  /** Preferred order of every tile uid (cameras and entities). Unknown uids go last. */
  readonly order: readonly string[];
  /** Camera tile width in 12-column grid units; absent = responsive default. */
  readonly spans: Readonly<Record<string, number>>;
  /** Tiles removed from the dashboard (they can still be in overlay groups). */
  readonly hidden: readonly string[];
  /** Display-name overrides for cameras and devices (UI only; providers keep theirs). */
  readonly names: Readonly<Record<string, string>>;
  /** Switch uids the user treats as lights (light icon, counted by All on / All off). */
  readonly lightSwitches: readonly string[];
  /** Switches the user un-marked even though their name says light (see `isLightLike`). */
  readonly notLightSwitches: readonly string[];
  /** Dashboard sections, shown above the default Cameras / area sections. A tile is in at most one. */
  readonly dashboardGroups: readonly TileGroup[];
  /** null = built-in overlay (all cameras + quick controls). */
  readonly overlayGroups: readonly TileGroup[] | null;
}

export const SPAN_MIN = 3;
export const SPAN_MAX = 12;
export const STORAGE_KEY = 'shcm.layout.v1';

const EMPTY: PersistedLayout = { order: [], spans: {}, hidden: [], names: {}, lightSwitches: [], notLightSwitches: [], dashboardGroups: withWidgets([]), overlayGroups: null };
const WIDTHS: ReadonlySet<string> = new Set<GroupWidth>(['full', 'twothirds', 'half', 'third']);
const isWidth = (v: unknown): v is GroupWidth => typeof v === 'string' && WIDTHS.has(v);

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

const parseGroup = (v: unknown): TileGroup | null => {
  if (!isRecord(v)) return null;
  const id = str(v['id']);
  if (!id) return null;
  return {
    id,
    name: str(v['name'], 'Group'),
    items: strings(v['items']),
    cameraView: v['cameraView'] === 'chips' ? 'chips' : 'live',
    width: isWidth(v['width']) ? v['width'] : 'full',
  };
};

const parseGroups = (v: unknown): TileGroup[] | null =>
  Array.isArray(v) ? v.map(parseGroup).filter((g): g is TileGroup => g !== null) : null;

export const loadLayout = (): PersistedLayout => {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return EMPTY;
  }
  const v = raw ? parseJson(raw) : undefined;
  if (!isRecord(v)) return EMPTY;
  const spans: Record<string, number> = {};
  if (isRecord(v['spans'])) {
    for (const [k, n] of Object.entries(v['spans'])) {
      if (typeof n === 'number' && n >= SPAN_MIN && n <= SPAN_MAX) spans[k] = Math.round(n);
    }
  }
  const names: Record<string, string> = {};
  if (isRecord(v['names'])) {
    for (const [k, n] of Object.entries(v['names'])) if (typeof n === 'string' && n.trim()) names[k] = n;
  }
  return {
    order: strings(v['order']),
    spans,
    hidden: strings(v['hidden']),
    names,
    lightSwitches: strings(v['lightSwitches']),
    notLightSwitches: strings(v['notLightSwitches']),
    dashboardGroups: withWidgets(parseGroups(v['dashboardGroups']) ?? []),
    overlayGroups: parseGroups(v['overlayGroups']),
  };
};

/** Picks the persisted fields out of the full store state, as JSON. */
export const serializeLayout = (s: PersistedLayout): string =>
  JSON.stringify({
    order: s.order,
    spans: s.spans,
    hidden: s.hidden,
    names: s.names,
    lightSwitches: s.lightSwitches,
    notLightSwitches: s.notLightSwitches,
    dashboardGroups: s.dashboardGroups,
    overlayGroups: s.overlayGroups,
  } satisfies PersistedLayout);

export const saveLayout = (json: string): void => {
  try {
    localStorage.setItem(STORAGE_KEY, json);
  } catch {
    // Storage full/blocked: layout just won't survive a restart.
  }
};
