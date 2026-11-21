import type { SmartEntity } from '../core/types';

/**
 * EV status from two Home Assistant integrations (both HACS):
 * - Audi Connect (`audiconnect`): the car's state of charge, range and plug.
 * - ChargePoint (`chargepoint`): the home charger's status and power.
 * Entity ids end in the integration's sensor names, e.g.
 * `sensor.audi_e_tron_state_of_charge`, `sensor.cph50_charging_status`.
 */
const CAR = 'audiconnect';
const CHARGER = 'chargepoint';

export type EvTone = 'charging' | 'plugged' | 'low' | 'idle' | 'unknown';

export interface EvStatus {
  /** Car name, e.g. "Audi e-tron". */
  readonly name: string;
  /** State of charge, 0–100. */
  readonly soc?: number;
  /** Range with its unit, e.g. "182 mi". */
  readonly range?: string;
  readonly charging: boolean;
  readonly plugged: boolean;
  /** Short status for the pill: "Charging 7.2 kW", "Charged", "Plugged in". */
  readonly label?: string;
  readonly tone: EvTone;
  /** Longer lines for the tooltip. */
  readonly details: readonly string[];
}

const LOW_SOC = 20;

const num = (e: SmartEntity | undefined): number | undefined => {
  if (!e?.available) return undefined;
  const n = Number(e.state);
  return Number.isFinite(n) ? n : undefined;
};
const unit = (e: SmartEntity): string => String(e.attributes['unit_of_measurement'] ?? '');
const live = (e: SmartEntity | undefined): e is SmartEntity => !!e && e.available && e.state !== 'unknown' && e.state !== 'unavailable';

/** Entities of one integration, or (without registry info, e.g. older HA) all of them. */
const from = (entities: readonly SmartEntity[], integration: string): SmartEntity[] => {
  const own = entities.filter((e) => e.integration === integration);
  return own.length ? own : entities.filter((e) => !e.integration);
};
/** First entity whose id ends in one of these sensor names. */
const find = (list: readonly SmartEntity[], domain: string, ...keys: string[]): SmartEntity | undefined => {
  for (const key of keys) {
    const hit = list.find((e) => e.domain === domain && e.nativeId.endsWith(`_${key}`));
    if (hit) return hit;
  }
  return undefined;
};

export interface EvEntities {
  readonly soc?: SmartEntity;
  readonly range?: SmartEntity;
  readonly carCharging?: SmartEntity;
  readonly plug?: SmartEntity;
  readonly remaining?: SmartEntity;
  readonly chargerStatus?: SmartEntity;
  readonly chargerPower?: SmartEntity;
  readonly chargerCable?: SmartEntity;
  readonly chargerEnergy?: SmartEntity;
}

export const pickEv = (entities: readonly SmartEntity[]): EvEntities => {
  const car = from(entities, CAR);
  const cp = from(entities, CHARGER);
  // An Audi has both; the electric range is "primary engine range" on an e-tron.
  const soc = find(car, 'sensor', 'state_of_charge');
  return {
    soc,
    range: find(car, 'sensor', 'primary_engine_range', 'range'),
    carCharging: find(car, 'sensor', 'charging_state'),
    plug: find(car, 'binary_sensor', 'plug_state'),
    remaining: find(car, 'sensor', 'remaining_charge_time', 'remaining_charging_time'),
    chargerStatus: find(cp, 'sensor', 'charging_status'),
    chargerPower: find(cp, 'sensor', 'power_output', 'session_power'),
    chargerCable: find(cp, 'sensor', 'charging_cable'),
    chargerEnergy: find(cp, 'sensor', 'energy_output', 'session_energy'),
  };
};

/** "Audi e-tron State of charge" → "Audi e-tron". */
const carName = (soc: SmartEntity | undefined): string => soc?.name.replace(/\s*state of charge\s*$/i, '').trim() || 'EV';

const isChargingWord = (s: string): boolean => /^charging$/i.test(s.trim());
const isDoneWord = (s: string): boolean => /fully charged|complete|purpose ?reached|conservation/i.test(s);

/** Combines the car and charger views; either one alone is enough. */
export const evStatus = (ev: EvEntities): EvStatus | null => {
  const hasAny = Object.values(ev).some((e) => e !== undefined);
  if (!hasAny) return null;

  const soc = num(ev.soc);
  const rangeN = num(ev.range);
  const range = rangeN !== undefined && ev.range ? `${Math.round(rangeN)} ${unit(ev.range)}`.trim() : undefined;
  const kw = num(ev.chargerPower) ?? 0;
  const cpState = live(ev.chargerStatus) ? ev.chargerStatus.state : '';
  const carState = live(ev.carCharging) ? ev.carCharging.state : '';

  const charging = kw > 0.05 || isChargingWord(cpState) || isChargingWord(carState);
  const done = !charging && (isDoneWord(cpState) || isDoneWord(carState));
  const plugged = charging || done || ev.chargerCable?.state === 'Plugged In' || ev.plug?.state === 'on';

  const label = charging ? (kw > 0.05 ? `Charging ${kw.toFixed(1)} kW` : 'Charging') : done ? 'Charged' : plugged ? 'Plugged in' : undefined;
  const anyLive = [ev.soc, ev.range, ev.chargerStatus, ev.carCharging].some(live);
  const tone: EvTone = !anyLive ? 'unknown' : charging ? 'charging' : soc !== undefined && soc < LOW_SOC ? 'low' : plugged ? 'plugged' : 'idle';

  const details: string[] = [];
  if (soc !== undefined) details.push(`Battery ${Math.round(soc)}%`);
  if (range) details.push(`Range ${range}`);
  if (cpState) details.push(`Charger: ${cpState}`);
  if (carState) details.push(`Car: ${carState}`);
  const kwh = num(ev.chargerEnergy);
  if (charging && kwh) details.push(`Added ${kwh.toFixed(1)} kWh this session`);
  const left = num(ev.remaining);
  if (charging && left && ev.remaining) details.push(`About ${left} ${unit(ev.remaining) || 'min'} to go`);

  return { name: carName(ev.soc), soc, range, charging, plugged, label, tone, details };
};
