import type { SmartEntity } from '../core/types';

export type DoorKind = 'garage' | 'lock' | 'door';
export type DoorTone = 'secure' | 'open' | 'moving' | 'unknown';

const dc = (e: SmartEntity): string => String(e.attributes['device_class'] ?? '');
const usable = (e: SmartEntity): boolean => !e.secondary;

const isGarage = (e: SmartEntity): boolean =>
  (e.domain === 'cover' && (dc(e) === 'garage' || /garage/i.test(e.name))) || (e.domain === 'binary_sensor' && dc(e) === 'garage_door');
const isFront = (e: SmartEntity): boolean => /front/i.test(e.name) || /front/i.test(e.nativeId);
const isDoorSensor = (e: SmartEntity): boolean => e.domain === 'binary_sensor' && (dc(e) === 'door' || dc(e) === 'opening');

/**
 * Which entities get a header pill: the garage door(s) (prefer the cover,
 * which also reports opening/closing), and the front door (prefer its lock,
 * else its door sensor). Either must have "front" in its name or ID; with
 * none, no front door pill is shown.
 */
export const pickDoors = (entities: readonly SmartEntity[]): { entity: SmartEntity; kind: DoorKind }[] => {
  const list = entities.filter(usable);
  const covers = list.filter((e) => e.domain === 'cover' && isGarage(e));
  const garages = covers.length ? covers : list.filter((e) => e.domain === 'binary_sensor' && isGarage(e));
  const locks = list.filter((e) => e.domain === 'lock');
  // Only a lock named for the front door: the sole lock in Home Assistant may be a car's.
  const frontLock = locks.find(isFront);
  const frontSensor = frontLock ? undefined : list.find((e) => isDoorSensor(e) && isFront(e));
  return [
    ...garages.map((entity) => ({ entity, kind: 'garage' as const })),
    ...(frontLock ? [{ entity: frontLock, kind: 'lock' as const }] : []),
    ...(frontSensor ? [{ entity: frontSensor, kind: 'door' as const }] : []),
  ];
};

/** What kind of pill an entity can be, or undefined if it isn't a door or lock. */
export const doorKind = (e: SmartEntity): DoorKind | undefined => {
  if (e.domain === 'lock') return 'lock';
  if (isGarage(e)) return 'garage';
  if (e.domain === 'cover' && (dc(e) === 'door' || dc(e) === 'gate')) return 'door';
  return isDoorSensor(e) ? 'door' : undefined;
};

/** Entities offered in the pill picker: locks, garage doors, doors and gates. */
export const doorCandidates = (entities: readonly SmartEntity[]): SmartEntity[] =>
  entities.filter((e) => usable(e) && doorKind(e) !== undefined).sort((a, b) => a.name.localeCompare(b.name));

/** The pills the user chose, in their order; missing or unsuitable entities are skipped. */
export const chosenDoors = (entities: readonly SmartEntity[], uids: readonly string[]): { entity: SmartEntity; kind: DoorKind }[] =>
  uids.flatMap((uid) => {
    const entity = entities.find((e) => e.uid === uid);
    const kind = entity && doorKind(entity);
    return entity && kind ? [{ entity, kind }] : [];
  });

/** Green for closed/locked, red for open/unlocked, yellow while moving. */
export const doorStatus = (e: SmartEntity, kind: DoorKind): { tone: DoorTone; label: string } => {
  if (!e.available) return { tone: 'unknown', label: 'Unavailable' };
  const s = e.state;
  if (kind === 'lock') {
    if (s === 'locked') return { tone: 'secure', label: 'Locked' };
    if (s === 'unlocked' || s === 'open' || s === 'jammed') return { tone: 'open', label: s === 'jammed' ? 'Jammed' : 'Unlocked' };
    if (s === 'locking' || s === 'unlocking' || s === 'opening') return { tone: 'moving', label: s[0]?.toUpperCase() + s.slice(1) };
    return { tone: 'unknown', label: s };
  }
  if (e.domain === 'binary_sensor') return s === 'off' ? { tone: 'secure', label: 'Closed' } : s === 'on' ? { tone: 'open', label: 'Open' } : { tone: 'unknown', label: s };
  if (s === 'closed') return { tone: 'secure', label: 'Closed' };
  if (s === 'open') return { tone: 'open', label: 'Open' };
  if (s === 'opening' || s === 'closing') return { tone: 'moving', label: s === 'opening' ? 'Opening' : 'Closing' };
  return { tone: 'unknown', label: s };
};
