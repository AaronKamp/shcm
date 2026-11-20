import { ArrowDown, ArrowUp, Camera, GripVertical, Plus, Trash2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useLayoutStore, type OverlayGroup } from '../../state/layoutStore';
import { useSortable } from '../layout/useSortable';
import { ItemPicker } from './ItemPicker';
import { itemSubtitle, type OverlayItem } from './items';

interface Props {
  readonly group: OverlayGroup;
  readonly index: number;
  readonly count: number;
  readonly items: readonly OverlayItem[];
  readonly byUid: ReadonlyMap<string, OverlayItem>;
}

const SCOPE = 'overlay';
const iconBtn = 'rounded-md p-1 text-slate-400 hover:bg-panel-hi hover:text-slate-100 disabled:opacity-30';

/** Edits one overlay group: name, camera display, item order and membership. */
export function GroupCard({ group, index, count, items, byUid }: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const [picking, setPicking] = useState(group.items.length === 0);
  const { updateGroup, removeGroup, moveGroup } = useLayoutStore.getState();
  const sortable = useSortable(listRef, group.items, (ids) => updateGroup(SCOPE, group.id, { items: ids }));

  return (
    <section className="rounded-xl border border-line bg-panel p-3" aria-label={`Group ${group.name}`}>
      <div className="flex items-center gap-2">
        <input
          value={group.name}
          onChange={(e) => updateGroup(SCOPE, group.id, { name: e.target.value })}
          aria-label="Group name"
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium text-slate-100 outline-none hover:border-line focus:border-accent"
        />
        <select
          value={group.cameraView}
          onChange={(e) => updateGroup(SCOPE, group.id, { cameraView: e.target.value === 'chips' ? 'chips' : 'live' })}
          aria-label="How cameras appear"
          title="How cameras appear in the overlay"
          className="rounded-lg border border-line bg-surface px-1.5 py-1 text-xs text-slate-200"
        >
          <option value="live">Cameras: live video</option>
          <option value="chips">Cameras: buttons</option>
        </select>
        <button type="button" className={iconBtn} disabled={index === 0} onClick={() => moveGroup(SCOPE, group.id, -1)} aria-label="Move group up">
          <ArrowUp className="h-4 w-4" />
        </button>
        <button type="button" className={iconBtn} disabled={index === count - 1} onClick={() => moveGroup(SCOPE, group.id, 1)} aria-label="Move group down">
          <ArrowDown className="h-4 w-4" />
        </button>
        <button type="button" className={`${iconBtn} hover:text-bad`} onClick={() => removeGroup(SCOPE, group.id)} aria-label={`Delete group ${group.name}`}>
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <ul ref={listRef} className="mt-2 space-y-1">
        {sortable.ids.map((uid) => {
          const item = byUid.get(uid);
          return (
            <li
              key={uid}
              data-sort-id={uid}
              className={`flex items-center gap-2 rounded-lg bg-surface px-2 py-1 text-sm ${sortable.dragging === uid ? 'opacity-60 ring-1 ring-accent' : ''}`}
            >
              <button type="button" className="cursor-grab touch-none text-slate-500 hover:text-slate-200" aria-label={`Move ${item?.name ?? 'item'}`} {...sortable.handleProps(uid)}>
                <GripVertical className="h-4 w-4" />
              </button>
              {item?.kind === 'camera' && <Camera className="h-3.5 w-3.5 text-slate-400" aria-hidden />}
              <span className={`min-w-0 flex-1 truncate ${item ? 'text-slate-100' : 'italic text-slate-500'}`}>{item?.name ?? 'Unavailable device'}</span>
              {item && <span className="shrink-0 text-xs text-slate-500">{itemSubtitle(item)}</span>}
              <button
                type="button"
                className={iconBtn}
                onClick={() => updateGroup(SCOPE, group.id, { items: group.items.filter((u) => u !== uid) })}
                aria-label={`Remove ${item?.name ?? 'item'} from ${group.name}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
      </ul>

      <button type="button" onClick={() => setPicking((p) => !p)} className="mt-2 flex items-center gap-1 text-xs text-accent hover:underline" aria-expanded={picking}>
        <Plus className="h-3.5 w-3.5" aria-hidden /> {picking ? 'Done adding' : 'Add items'}
      </button>
      {picking && <ItemPicker items={items} chosen={group.items} onChange={(uids) => updateGroup(SCOPE, group.id, { items: uids })} />}
    </section>
  );
}
