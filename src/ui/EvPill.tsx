import { BatteryCharging, BatteryLow, Car, PlugZap } from 'lucide-react';
import { useMemo } from 'react';
import { useDeviceStore } from '../state/deviceStore';
import { evStatus, pickEv, type EvTone } from './evState';

const TONE: Readonly<Record<EvTone, string>> = {
  charging: 'border-ok/40 bg-ok/15 text-ok',
  plugged: 'border-accent/40 bg-accent/10 text-accent',
  low: 'border-warn/40 bg-warn/15 text-warn',
  idle: 'border-line bg-panel text-slate-300',
  unknown: 'border-line bg-panel text-slate-400',
};

/**
 * Header pill for the EV: battery %, range, and charging state
 * (from Audi Connect and the ChargePoint home charger in Home Assistant).
 */
export function EvPill() {
  const entities = useDeviceStore((s) => s.entities);
  const ev = useMemo(() => evStatus(pickEv(entities)), [entities]);
  if (!ev) return null;
  const Icon = ev.charging ? BatteryCharging : ev.tone === 'low' ? BatteryLow : ev.plugged ? PlugZap : Car;
  const summary = [ev.soc !== undefined ? `${Math.round(ev.soc)}%` : undefined, ev.range].filter(Boolean).join(' · ');
  return (
    <span
      role="status"
      title={[ev.name, ...ev.details].join('\n')}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${TONE[ev.tone]}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span className="text-slate-200">{ev.name}</span>
      {summary && <span>{summary}</span>}
      {ev.label && <span className="text-slate-300">· {ev.label}</span>}
      {!summary && !ev.label && <span>{ev.tone === 'unknown' ? 'Unavailable' : 'No data'}</span>}
    </span>
  );
}
