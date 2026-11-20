import {
  Car,
  Fan,
  Gauge,
  Lightbulb,
  Lock,
  Power,
  Radio,
  Thermometer,
  ToggleLeft,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import type { DeviceCommand, JsonObject, SmartEntity } from '../core/types';

export interface EntityAction {
  readonly label: string;
  readonly command: DeviceCommand;
}

export const cmd = (e: SmartEntity, action: string, payload?: JsonObject): DeviceCommand =>
  payload === undefined
    ? { providerId: e.providerId, domain: e.domain, action, targetId: e.nativeId }
    : { providerId: e.providerId, domain: e.domain, action, targetId: e.nativeId, payload };

/** Whether the entity is in its "active" state, for card highlighting. */
export const isActive = (e: SmartEntity): boolean =>
  ['on', 'open', 'unlocked', 'playing', 'cleaning', 'heat', 'cool', 'auto'].includes(e.state);

/** The single tap action for a card; null for read-only entities (sensors). */
export const primaryAction = (e: SmartEntity): EntityAction | null => {
  switch (e.domain) {
    case 'light':
    case 'switch':
    case 'media_player':
      return e.state === 'off' ? { label: 'Turn on', command: cmd(e, 'turn_on') } : { label: 'Turn off', command: cmd(e, 'turn_off') };
    case 'lock':
      return e.state === 'locked' ? { label: 'Unlock', command: cmd(e, 'unlock') } : { label: 'Lock', command: cmd(e, 'lock') };
    case 'cover':
      return e.state === 'closed' ? { label: 'Open', command: cmd(e, 'open_cover') } : { label: 'Close', command: cmd(e, 'close_cover') };
    case 'vacuum':
      return e.state === 'cleaning' ? { label: 'Dock', command: cmd(e, 'return_to_base') } : { label: 'Start', command: cmd(e, 'start') };
    default:
      return null;
  }
};

/** Secondary stepper actions (climate setpoint). */
export const stepActions = (e: SmartEntity): readonly EntityAction[] => {
  if (e.domain !== 'climate') return [];
  const target = typeof e.attributes['temperature'] === 'number' ? e.attributes['temperature'] : 70;
  return [
    { label: '−', command: cmd(e, 'set_temperature', { temperature: target - 1 }) },
    { label: '+', command: cmd(e, 'set_temperature', { temperature: target + 1 }) },
  ];
};

export const domainIcon = (domain: string): LucideIcon => {
  switch (domain) {
    case 'light':
      return Lightbulb;
    case 'switch':
      return ToggleLeft;
    case 'lock':
      return Lock;
    case 'climate':
      return Thermometer;
    case 'media_player':
      return Radio;
    case 'vacuum':
      return Fan;
    case 'cover':
      return Car;
    case 'sensor':
    case 'binary_sensor':
      return Gauge;
    case 'webhook':
      return Webhook;
    default:
      return Power;
  }
};

/** Human-readable state + key attribute, e.g. "On · 78%". */
export const describeState = (e: SmartEntity): string => {
  if (!e.available) return 'Unavailable';
  const a = e.attributes;
  const pretty = e.state.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  if (e.domain === 'light' && e.state === 'on' && typeof a['brightness'] === 'number') {
    return `${pretty} · ${Math.round((a['brightness'] / 255) * 100)}%`;
  }
  if (e.domain === 'climate' && typeof a['current_temperature'] === 'number') {
    const target = typeof a['temperature'] === 'number' ? ` → ${a['temperature']}°` : '';
    return `${pretty} · ${a['current_temperature'].toFixed(1)}°${target}`;
  }
  if (e.domain === 'media_player' && e.state !== 'off' && e.state !== 'standby') {
    const parts = [pretty];
    if (typeof a['source'] === 'string' && a['source']) parts.push(a['source']);
    if (a['is_volume_muted'] === true) parts.push('muted');
    else if (typeof a['volume_level'] === 'number') parts.push(`vol ${Math.round(a['volume_level'] * 100)}%`);
    return parts.join(' · ');
  }
  if (e.domain === 'sensor' && typeof a['unit_of_measurement'] === 'string') return `${e.state} ${a['unit_of_measurement']}`;
  if (e.domain === 'binary_sensor') return e.state === 'on' ? 'Detected' : 'Clear';
  if (e.domain === 'vacuum' && typeof a['battery_level'] === 'number') return `${pretty} · ${a['battery_level']}%`;
  return pretty;
};
