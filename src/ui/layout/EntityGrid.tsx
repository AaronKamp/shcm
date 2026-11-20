import { useMemo, useRef } from 'react';
import type { SmartEntity } from '../../core/types';
import { applyOrder, isLightLike, useLayoutStore, useLightSwitchPrefs, withName } from '../../state/layoutStore';
import { EntityCard } from '../EntityCard';
import { MediaAppsButton } from '../media/MediaAppsButton';
import { EditChrome } from './EditChrome';
import { useSortable } from './useSortable';

/** One section's device cards, reorderable and renamable in edit mode. */
export function EntityGrid({ entities }: { entities: readonly SmartEntity[] }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const order = useLayoutStore((s) => s.order);
  const names = useLayoutStore((s) => s.names);
  const editing = useLayoutStore((s) => s.editing);
  const selected = useLayoutStore((s) => s.selected);
  const lightPrefs = useLightSwitchPrefs();
  const { reorder, toggleSelected, toggleLightSwitch } = useLayoutStore.getState();

  const ordered = useMemo(() => applyOrder(entities, order), [entities, order]);
  // withName keeps object identity when there's no override, so EntityCard's memo holds.
  const byUid = useMemo(() => new Map(entities.map((e) => [e.uid, { original: e, shown: withName(e, names) }])), [entities, names]);
  const sortable = useSortable(gridRef, useMemo(() => ordered.map((e) => e.uid), [ordered]), reorder);

  return (
    <div ref={gridRef} className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
      {sortable.ids.map((uid) => {
        const entry = byUid.get(uid);
        if (!entry) return null;
        const { original, shown } = entry;
        return (
          <div key={uid} data-sort-id={uid} className={`relative ${sortable.dragging === uid ? 'opacity-60' : ''}`}>
            <EntityCard entity={shown} />
            {editing && (
              <EditChrome
                uid={uid}
                name={shown.name}
                defaultName={original.name}
                selected={selected.has(uid)}
                onToggle={() => toggleSelected(uid)}
                sortable={sortable}
                compact
                lightToggle={(() => {
                  if (original.domain !== 'switch') return undefined;
                  const on = isLightLike(shown, lightPrefs);
                  return { on, onToggle: () => toggleLightSwitch(uid, on) };
                })()}
              >
                {original.domain === 'media_player' && <MediaAppsButton speaker={shown} />}
              </EditChrome>
            )}
          </div>
        );
      })}
    </div>
  );
}
