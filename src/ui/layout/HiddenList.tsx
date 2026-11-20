import { Eye, X } from 'lucide-react';
import { useLayoutStore } from '../../state/layoutStore';
import { itemSubtitle, useOverlayItems } from '../overlay/items';

/** Popover listing tiles hidden from the dashboard, each with a Show button. */
export function HiddenList({ onClose }: { onClose: () => void }) {
  const hidden = useLayoutStore((s) => s.hidden);
  const { unhide } = useLayoutStore.getState();
  const { byUid } = useOverlayItems();

  return (
    <div className="w-full max-w-sm rounded-2xl border border-line bg-panel/95 p-2 text-sm shadow-2xl backdrop-blur" role="region" aria-label="Hidden tiles">
      <div className="mb-1 flex items-center px-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Hidden from dashboard</span>
        {hidden.length > 1 && (
          <button type="button" onClick={() => unhide(hidden)} className="ml-auto rounded-md px-2 py-0.5 text-xs text-accent hover:bg-panel-hi">
            Show all
          </button>
        )}
        <button type="button" onClick={onClose} aria-label="Close hidden list" className={`${hidden.length > 1 ? '' : 'ml-auto'} rounded-md p-1 text-slate-400 hover:bg-panel-hi`}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ul className="max-h-56 overflow-y-auto">
        {hidden.map((uid) => {
          const item = byUid.get(uid);
          return (
            <li key={uid} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-panel-hi">
              <span className={`min-w-0 flex-1 truncate ${item ? 'text-slate-100' : 'italic text-slate-500'}`}>{item?.name ?? 'Unavailable device'}</span>
              {item && <span className="shrink-0 text-xs text-slate-500">{itemSubtitle(item)}</span>}
              <button type="button" onClick={() => unhide([uid])} className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-accent hover:bg-surface" aria-label={`Show ${item?.name ?? 'item'}`}>
                <Eye className="h-3.5 w-3.5" aria-hidden /> Show
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
