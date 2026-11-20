import type { SmartEntity } from '../../core/types';

const MOTION_CLASSES = new Set(['motion', 'occupancy', 'presence', 'moving']);

/** Motion and smart-detect sensors (UniFi Protect exposes both per camera through HA). */
export const motionCandidates = (entities: readonly SmartEntity[]): SmartEntity[] =>
  entities.filter((e) => {
    if (e.domain !== 'binary_sensor') return false;
    const cls = e.attributes['device_class'];
    return (typeof cls === 'string' && MOTION_CLASSES.has(cls)) || /motion|person|vehicle|detected|occupancy/i.test(e.name);
  });

const isFront = (e: SmartEntity): boolean => /front/i.test(`${e.name} ${e.area ?? ''}`);

/** The sensors that keep the screensaver off; `null` setting = every "front" one. */
export const watchedSensors = (entities: readonly SmartEntity[], setting: readonly string[] | null): SmartEntity[] => {
  const all = motionCandidates(entities);
  if (setting === null) return all.filter(isFront);
  const chosen = new Set(setting);
  return all.filter((e) => chosen.has(e.uid));
};

export const weatherEntities = (entities: readonly SmartEntity[]): SmartEntity[] => entities.filter((e) => e.domain === 'weather');

export const pickWeather = (entities: readonly SmartEntity[], setting: string): SmartEntity | undefined => {
  const all = weatherEntities(entities);
  return all.find((e) => e.uid === setting) ?? all[0];
};

/** True after sunset: HA's sun entity when present, else 7pm–6am. */
export const isNight = (entities: readonly SmartEntity[], now: Date): boolean => {
  const sun = entities.find((e) => e.domain === 'sun');
  if (sun) return sun.state === 'below_horizon';
  const h = now.getHours();
  return h >= 19 || h < 6;
};
