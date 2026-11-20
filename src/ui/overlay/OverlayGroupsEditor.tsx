import { Plus, RotateCcw, X } from 'lucide-react';
import { useEffect } from 'react';
import { useLayoutStore } from '../../state/layoutStore';
import { GroupCard } from './GroupCard';
import { useOverlayItems } from './items';

/** Modal for choosing what the overlay shows, in named groups. Changes apply live. */
export function OverlayGroupsEditor({ onClose }: { onClose: () => void }) {
  const groups = useLayoutStore((s) => s.overlayGroups);
  const { addGroup, resetOverlay } = useLayoutStore.getState();
  const { list, byUid } = useOverlayItems();

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4" role="dialog" aria-modal aria-label="Overlay groups">
      <div className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <header className="flex items-center gap-2 border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold">Overlay groups</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto rounded-md p-1 text-slate-400 hover:bg-panel-hi hover:text-slate-100">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          <p className="text-xs text-slate-400">
            {groups === null
              ? 'The overlay currently shows every camera plus quick controls. Create a group to choose exactly what it shows.'
              : 'The overlay shows these groups in order. Changes apply right away.'}
          </p>
          {groups?.map((g, i) => (
            <GroupCard key={g.id} group={g} index={i} count={groups.length} items={list} byUid={byUid} />
          ))}
        </div>

        <footer className="flex items-center gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={() => addGroup('overlay', `Group ${(groups?.length ?? 0) + 1}`)}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white"
          >
            <Plus className="h-4 w-4" aria-hidden /> New group
          </button>
          {groups !== null && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Delete all overlay groups and go back to the built-in overlay?')) resetOverlay();
              }}
              title="Remove all groups and show the built-in overlay"
              className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-panel-hi"
            >
              <RotateCcw className="h-4 w-4" aria-hidden /> Reset to default
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
