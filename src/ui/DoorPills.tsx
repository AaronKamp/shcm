import { DoorClosed, DoorOpen, Lock, LockOpen, Warehouse, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import type { SmartEntity } from '../core/types';
import { useDeviceStore } from '../state/deviceStore';
import { useLayoutStore, withName } from '../state/layoutStore';
import { doorStatus, pickDoors, type DoorKind } from './doorState';

const ICONS: Readonly<Record<DoorKind, { readonly secure: LucideIcon; readonly open: LucideIcon }>> = {
  garage: { secure: Warehouse, open: Warehouse },
  lock: { secure: Lock, open: LockOpen },
  door: { secure: DoorClosed, open: DoorOpen },
};

const TONE = {
  secure: 'border-ok/40 bg-ok/15 text-ok',
  open: 'border-bad/50 bg-bad/20 text-bad',
  moving: 'border-warn/40 bg-warn/15 text-warn',
  unknown: 'border-line bg-panel text-slate-400',
} as const;

/**
 * Header pills for the garage door and front door: green when closed/locked,
 * red when open/unlocked, yellow while moving. Status only; control them from their tiles.
 */
export function DoorStatus() {
  const entities = useDeviceStore((s) => s.entities);
  const names = useLayoutStore((s) => s.names);
  const doors = useMemo(() => pickDoors(entities).map((d) => ({ ...d, entity: withName(d.entity, names) })), [entities, names]);
  if (doors.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Doors">
      {doors.map(({ entity, kind }) => (
        <Pill key={entity.uid} entity={entity} kind={kind} />
      ))}
    </div>
  );
}

function Pill({ entity, kind }: { entity: SmartEntity; kind: DoorKind }) {
  const s = doorStatus(entity, kind);
  const Icon = s.tone === 'secure' ? ICONS[kind].secure : ICONS[kind].open;
  // Generic device names ("Door 1") read better as what they are.
  const name = kind === 'garage' ? (/garage/i.test(entity.name) ? entity.name : 'Garage Door') : /front/i.test(entity.name) ? entity.name : 'Front Door';
  return (
    <span
      role="status"
      title={`${entity.name}: ${s.label}`}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${TONE[s.tone]}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span className="text-slate-200">{name}</span>
      <span>{s.label}</span>
    </span>
  );
}
