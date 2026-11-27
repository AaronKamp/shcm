import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { SmartEntity } from '../core/types';
import { setDoorPills, useDoorPillStore } from '../state/doorPillStore';
import { useDeviceStore } from '../state/deviceStore';
import { useLayoutStore, withName } from '../state/layoutStore';
import { doorCandidates, doorKind, doorStatus, pickDoors } from './doorState';

const GROUPS = [
  { title: 'Locks', test: (e: SmartEntity) => doorKind(e) === 'lock' },
  { title: 'Garage doors, doors and gates', test: (e: SmartEntity) => doorKind(e) !== 'lock' },
] as const;

/**
 * Choose which locks and doors appear as header pills, and their order.
 * Unticking hides a pill; "Automatic" goes back to the built-in choice.
 */
export function DoorPillsEditor({ onClose }: { onClose: () => void }) {
  const entities = useDeviceStore((s) => s.entities);
  const names = useLayoutStore((s) => s.names);
  const custom = useDoorPillStore((s) => s.custom);
  const candidates = useMemo(() => doorCandidates(entities).map((e) => withName(e, names)), [entities, names]);
  const shown = useMemo(() => custom ?? pickDoors(entities).map((d) => d.entity.uid), [custom, entities]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (uid: string): void => setDoorPills(shown.includes(uid) ? shown.filter((u) => u !== uid) : [...shown, uid]);
  const move = (uid: string, by: -1 | 1): void => {
    const i = shown.indexOf(uid);
    const j = i + by;
    if (i < 0 || j < 0 || j >= shown.length) return;
    const next = [...shown];
    [next[i], next[j]] = [next[j] as string, next[i] as string];
    setDoorPills(next);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal
        aria-label="Door pills"
        className="flex max-h-[85vh] w-full max-w-md flex-col gap-3 rounded-xl border border-line bg-panel p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-slate-100">Door pills</h2>
            <p className="text-xs text-slate-400">Tick the locks and doors to show in the header. {custom ? 'Using your choice.' : 'Automatic: garage doors plus a lock or door sensor named "front".'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-slate-400 hover:bg-panel-hi hover:text-slate-100">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="-mx-1 flex flex-col gap-3 overflow-y-auto px-1">
          {candidates.length === 0 && <p className="text-sm text-slate-400">No locks or doors found in Home Assistant.</p>}
          {GROUPS.map(({ title, test }) => {
            const rows = candidates.filter(test);
            if (rows.length === 0) return null;
            return (
              <section key={title} className="flex flex-col gap-1">
                <h3 className="text-xs uppercase tracking-wider text-slate-500">{title}</h3>
                {rows.map((e) => (
                  <Row key={e.uid} entity={e} index={shown.indexOf(e.uid)} count={shown.length} onToggle={toggle} onMove={move} />
                ))}
              </section>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
          <button
            type="button"
            disabled={!custom}
            onClick={() => setDoorPills(null)}
            className="rounded-md px-3 py-1.5 text-sm text-slate-300 hover:bg-panel-hi disabled:opacity-40"
          >
            Automatic
          </button>
          <button type="button" onClick={onClose} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white">
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface RowProps {
  entity: SmartEntity;
  index: number;
  count: number;
  onToggle: (uid: string) => void;
  onMove: (uid: string, by: -1 | 1) => void;
}

function Row({ entity, index, count, onToggle, onMove }: RowProps) {
  const kind = doorKind(entity) ?? 'door';
  const on = index >= 0;
  const arrow = 'rounded p-1 text-slate-400 hover:bg-panel-hi hover:text-slate-100 disabled:opacity-30';
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-panel-hi">
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
        <input type="checkbox" checked={on} onChange={() => onToggle(entity.uid)} className="h-4 w-4 accent-accent" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-slate-100">{entity.name}</span>
          <span className="block truncate text-xs text-slate-500">
            {doorStatus(entity, kind).label}
            {entity.area ? ` · ${entity.area}` : ''} · {entity.nativeId}
          </span>
        </span>
      </label>
      {on && count > 1 && (
        <>
          <button type="button" className={arrow} disabled={index === 0} onClick={() => onMove(entity.uid, -1)} aria-label={`Move ${entity.name} left`}>
            <ChevronUp className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" className={arrow} disabled={index === count - 1} onClick={() => onMove(entity.uid, 1)} aria-label={`Move ${entity.name} right`}>
            <ChevronDown className="h-4 w-4" aria-hidden />
          </button>
        </>
      )}
    </div>
  );
}
