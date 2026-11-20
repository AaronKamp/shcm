import { Check, Lightbulb, Move, Pencil } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useLayoutStore } from '../../state/layoutStore';
import { RenameField } from './RenameField';
import type { Sortable } from './useSortable';

interface Props {
  readonly uid: string;
  /** Name as shown (may be the user's override). */
  readonly name: string;
  /** The provider's name, restored when the override is cleared. */
  readonly defaultName: string;
  readonly selected: boolean;
  readonly onToggle: () => void;
  readonly sortable: Sortable;
  readonly children?: ReactNode;
  /** Small tile (device card): controls at the edges instead of the corner/center. */
  readonly compact?: boolean;
  /** Switches only: whether it counts as a light (icon + All on / All off). */
  readonly lightToggle?: { readonly on: boolean; readonly onToggle: () => void };
}

/**
 * Edit-mode layer over a tile: a click target that selects it (so arranging
 * never toggles a light), a checkbox, a rename button, and a move grip (drag,
 * or arrow keys).
 */
export function EditChrome({ uid, name, defaultName, selected, onToggle, sortable, children, compact = false, lightToggle }: Props) {
  const [renaming, setRenaming] = useState(false);
  const { setName } = useLayoutStore.getState();

  return (
    <div className={`absolute inset-0 z-20 rounded-xl ring-2 ${selected ? 'bg-accent/15 ring-accent' : 'ring-transparent hover:ring-white/20'}`}>
      <button type="button" onClick={onToggle} aria-pressed={selected} aria-label={`Select ${name}`} className="absolute inset-0 cursor-pointer rounded-xl" />
      <span
        aria-hidden
        className={`pointer-events-none absolute ${compact ? '-left-1.5 -top-1.5' : 'bottom-2 left-2'} flex h-5 w-5 items-center justify-center rounded border ${selected ? 'border-accent bg-accent text-white' : 'border-slate-400 bg-black/50'}`}
      >
        {selected && <Check className="h-3.5 w-3.5" />}
      </span>
      <button
        type="button"
        onClick={() => setRenaming(true)}
        aria-label={`Rename ${name}`}
        title="Rename"
        className={`absolute ${compact ? '-right-1.5 -top-1.5 p-0.5' : 'right-2 top-2 p-1'} rounded-md bg-black/70 text-slate-200 ring-1 ring-white/20 hover:bg-black/90`}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      {lightToggle && (
        <button
          type="button"
          onClick={lightToggle.onToggle}
          aria-pressed={lightToggle.on}
          aria-label={`Count ${name} as a light`}
          title={lightToggle.on ? 'Counted as a light — click to stop' : 'Count as a light (light icon, All on / All off)'}
          className={`absolute -top-1.5 right-6 flex items-center gap-1 rounded-md px-1 py-0.5 text-[10px] font-medium ring-1 ${lightToggle.on ? 'bg-warn text-black ring-warn' : 'bg-black/70 text-slate-200 ring-white/20 hover:bg-black/90'}`}
        >
          <Lightbulb className="h-3 w-3" aria-hidden /> {lightToggle.on ? 'Light' : 'Light?'}
        </button>
      )}
      <button
        type="button"
        aria-label={`Move ${name} (drag, or use arrow keys)`}
        title="Drag to move"
        className={`absolute top-1/2 -translate-y-1/2 ${compact ? 'right-2' : 'left-1/2 -translate-x-1/2'} touch-none rounded-lg bg-black/70 p-1.5 text-slate-100 shadow-lg ring-1 ring-white/20 hover:bg-black/90 ${sortable.dragging === uid ? 'cursor-grabbing' : 'cursor-grab'}`}
        {...sortable.handleProps(uid)}
      >
        <Move className="h-4 w-4" />
      </button>
      {children}
      {renaming && (
        <RenameField
          value={name}
          defaultName={defaultName}
          onSave={(next) => {
            setName(uid, next === defaultName ? null : next);
            setRenaming(false);
          }}
          onCancel={() => setRenaming(false)}
        />
      )}
    </div>
  );
}
