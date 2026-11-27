import { DoorClosed, DoorOpen, Lock, LockOpen, SlidersHorizontal, Warehouse, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { SmartEntity } from '../core/types';
import { useDeviceStore } from '../state/deviceStore';
import { useDoorPillStore } from '../state/doorPillStore';
import { useLayoutStore, withName } from '../state/layoutStore';
import { DoorPillsEditor } from './DoorPillsEditor';
import { chosenDoors, doorStatus, pickDoors, type DoorKind } from './doorState';
import { useLongPress } from './useLongPress';

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

/** Automatic picks: generic device names ("Door 1") read better as what they are. */
const autoName = (e: SmartEntity, kind: DoorKind): string =>
  kind === 'garage' ? (/garage/i.test(e.name) ? e.name : 'Garage Door') : /front/i.test(e.name) ? e.name : 'Front Door';

/**
 * Header pills for the garage door, front door and any other chosen locks or
 * doors: green when closed/locked, red when open/unlocked, yellow while
 * moving. Status only; long-press (or right-click) a pill to choose which
 * ones show. In Edit layout a button opens the same picker.
 */
export function DoorStatus() {
  const entities = useDeviceStore((s) => s.entities);
  const names = useLayoutStore((s) => s.names);
  const editing = useLayoutStore((s) => s.editing);
  const custom = useDoorPillStore((s) => s.custom);
  const [picking, setPicking] = useState(false);
  const doors = useMemo(
    () =>
      (custom ? chosenDoors(entities, custom) : pickDoors(entities)).map((d) => {
        const entity = withName(d.entity, names);
        return { ...d, entity, label: custom ? entity.name : autoName(entity, d.kind) };
      }),
    [entities, names, custom],
  );
  const press = useLongPress(() => setPicking(true));

  // Keep the picker open even after its last pill is unticked.
  if (doors.length === 0 && !editing) return picking ? <DoorPillsEditor onClose={() => setPicking(false)} /> : null;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Doors">
      {doors.map(({ entity, kind, label }) => (
        <Pill key={entity.uid} entity={entity} kind={kind} label={label} press={press} />
      ))}
      {editing && (
        <button
          type="button"
          onClick={() => setPicking(true)}
          title="Choose which locks and doors show in the header"
          className="flex items-center gap-1.5 rounded-full border border-dashed border-line px-2.5 py-1 text-xs text-slate-400 hover:bg-panel-hi hover:text-slate-100"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> Door pills
        </button>
      )}
      {picking && <DoorPillsEditor onClose={() => setPicking(false)} />}
    </div>
  );
}

interface PillProps {
  entity: SmartEntity;
  kind: DoorKind;
  label: string;
  press: ReturnType<typeof useLongPress>;
}

function Pill({ entity, kind, label, press }: PillProps) {
  const s = doorStatus(entity, kind);
  const Icon = s.tone === 'secure' ? ICONS[kind].secure : ICONS[kind].open;
  return (
    <span
      role="status"
      tabIndex={0}
      title={`${entity.name}: ${s.label}. Long-press to choose door pills.`}
      {...press}
      className={`flex select-none items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium [-webkit-touch-callout:none] ${TONE[s.tone]}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span className="text-slate-200">{label}</span>
      <span>{s.label}</span>
    </span>
  );
}
