import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { itemSubtitle, type OverlayItem } from './items';

interface Props {
  readonly items: readonly OverlayItem[];
  readonly chosen: readonly string[];
  readonly onChange: (uids: readonly string[]) => void;
}

/** Searchable checklist of cameras and devices for one overlay group. */
export function ItemPicker({ items, chosen, onChange }: Props) {
  const [query, setQuery] = useState('');
  const set = useMemo(() => new Set(chosen), [chosen]);
  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((i) => `${i.name} ${itemSubtitle(i)}`.toLowerCase().includes(q)) : items;

  const toggle = (uid: string): void => onChange(set.has(uid) ? chosen.filter((u) => u !== uid) : [...chosen, uid]);

  return (
    <div className="mt-2 rounded-lg border border-line bg-surface">
      <label className="flex items-center gap-2 border-b border-line px-2 py-1.5">
        <Search className="h-3.5 w-3.5 text-slate-500" aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search cameras and devices"
          aria-label="Search cameras and devices"
          className="w-full bg-transparent text-sm text-slate-100 outline-none"
        />
      </label>
      <ul className="max-h-56 overflow-y-auto py-1">
        {shown.map((i) => (
          <li key={i.uid}>
            <label className="flex cursor-pointer items-center gap-2 px-2 py-1 text-sm hover:bg-panel-hi">
              <input type="checkbox" checked={set.has(i.uid)} onChange={() => toggle(i.uid)} className="accent-accent" />
              <span className="min-w-0 flex-1 truncate text-slate-100">{i.name}</span>
              <span className="shrink-0 text-xs text-slate-500">{itemSubtitle(i)}</span>
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="px-2 py-2 text-xs text-slate-500">No matches</li>}
      </ul>
    </div>
  );
}
