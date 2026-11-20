import { Eye, EyeOff, FolderPlus, LayoutList, Ungroup } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { isWidgetGroup } from '../../state/layoutPersist';
import { useLayoutStore, type GroupScope } from '../../state/layoutStore';
import { HiddenList } from './HiddenList';

/** Select values: `<scope>:<groupId>` or `<scope>:new`. */
const parseTarget = (value: string): { scope: GroupScope; id: string } => {
  const [scope, id = 'new'] = value.split(':');
  return { scope: scope === 'overlay' ? 'overlay' : 'dashboard', id };
};

const btn = 'flex items-center gap-1.5 rounded-lg px-2 py-1 text-slate-300 hover:bg-panel-hi disabled:opacity-40';

/** Floating bar in dashboard edit mode: group, hide, or send the selection to the overlay. */
export function SelectionBar({ onManageGroups }: { onManageGroups: () => void }) {
  const selected = useLayoutStore((s) => s.selected);
  // The Now Playing group holds the card, not tiles.
  const allDashboardGroups = useLayoutStore((s) => s.dashboardGroups);
  const dashboardGroups = useMemo(() => allDashboardGroups.filter((g) => !isWidgetGroup(g)), [allDashboardGroups]);
  const overlayGroups = useLayoutStore((s) => s.overlayGroups) ?? [];
  const hiddenCount = useLayoutStore((s) => s.hidden.length);
  const { addGroup, addToGroup, ungroup, hide, clearSelection, setEditing } = useLayoutStore.getState();
  const [target, setTarget] = useState('dashboard:new');
  const [name, setName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const { scope, id } = parseTarget(target);
  const groups = scope === 'dashboard' ? dashboardGroups : overlayGroups;
  const known = id === 'new' || groups.some((g) => g.id === id);
  const uids = [...selected];
  const inDashboardGroup = dashboardGroups.some((g) => g.items.some((u) => selected.has(u)));

  const flash = (text: string): void => {
    setNotice(text);
    setTimeout(() => setNotice(null), 3000);
  };

  const add = (e: FormEvent): void => {
    e.preventDefault();
    if (uids.length === 0) return;
    const where = scope;
    if (id === 'new' || !known) {
      const label = name.trim() || `Group ${groups.length + 1}`;
      setTarget(`${scope}:${addGroup(scope, label, uids)}`);
      setName('');
      flash(`Made ${where} group “${label}” with ${uids.length}`);
    } else {
      addToGroup(scope, id, uids);
      flash(`Added ${uids.length} to ${where} group “${groups.find((g) => g.id === id)?.name ?? ''}”`);
    }
    clearSelection();
  };

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      {showHidden && <HiddenList onClose={() => setShowHidden(false)} />}
      <form onSubmit={add} className="flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-line bg-panel/95 px-3 py-2 text-sm shadow-2xl backdrop-blur" aria-label="Layout editor">
        <span className="text-xs text-slate-400" role="status" title="Click tiles to select · drag the move handle to reorder · drag a camera’s corner to resize">
          {notice ?? (selected.size ? `${selected.size} selected` : 'Click tiles to select')}
        </span>
        <select
          value={known ? target : `${scope}:new`}
          onChange={(e) => setTarget(e.target.value)}
          aria-label="Group to add to"
          className="max-w-48 rounded-lg border border-line bg-surface px-2 py-1 text-sm text-slate-100"
        >
          <optgroup label="Dashboard">
            {dashboardGroups.map((g) => (
              <option key={g.id} value={`dashboard:${g.id}`}>
                {g.name || 'Untitled'}
              </option>
            ))}
            <option value="dashboard:new">New dashboard group…</option>
          </optgroup>
          <optgroup label="Overlay">
            {overlayGroups.map((g) => (
              <option key={g.id} value={`overlay:${g.id}`}>
                {g.name || 'Untitled'}
              </option>
            ))}
            <option value="overlay:new">New overlay group…</option>
          </optgroup>
        </select>
        {(id === 'new' || !known) && (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`Group ${groups.length + 1}`}
            aria-label="New group name"
            className="w-32 rounded-lg border border-line bg-surface px-2 py-1 text-sm text-slate-100 outline-none focus:border-accent"
          />
        )}
        <button type="submit" disabled={selected.size === 0} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1 font-medium text-white disabled:opacity-40">
          <FolderPlus className="h-4 w-4" aria-hidden /> Add
        </button>
        {inDashboardGroup && (
          <button type="button" className={btn} onClick={() => {
              ungroup('dashboard', uids);
              clearSelection();
            }} title="Take the selected tiles out of their dashboard group">
            <Ungroup className="h-4 w-4" aria-hidden /> Ungroup
          </button>
        )}
        <button type="button" className={btn} disabled={selected.size === 0} onClick={() => {
            hide(uids);
            flash(`Hid ${uids.length} from the dashboard`);
          }}>
          <EyeOff className="h-4 w-4" aria-hidden /> Hide
        </button>
        {hiddenCount > 0 && (
          <button type="button" className={btn} aria-expanded={showHidden} onClick={() => setShowHidden((s) => !s)}>
            <Eye className="h-4 w-4" aria-hidden /> Hidden ({hiddenCount})
          </button>
        )}
        {selected.size > 0 && (
          <button type="button" className={btn} onClick={clearSelection}>
            Clear
          </button>
        )}
        <button type="button" className={btn} onClick={onManageGroups} title="Edit overlay groups">
          <LayoutList className="h-4 w-4" aria-hidden /> Overlay
        </button>
        <button type="button" onClick={() => setEditing(false)} className="rounded-lg border border-line px-3 py-1 text-slate-100 hover:bg-panel-hi">
          Done
        </button>
      </form>
    </div>
  );
}
