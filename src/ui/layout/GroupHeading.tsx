import { ArrowDown, ArrowUp, Eye, EyeOff, Ungroup } from 'lucide-react';
import { isWidgetGroup } from '../../state/layoutPersist';
import { useLayoutStore, type GroupWidth, type TileGroup } from '../../state/layoutStore';
import { useNowPlayingStore } from '../../state/nowPlayingStore';

const WIDTHS: readonly GroupWidth[] = ['full', 'twothirds', 'half', 'third'];

interface Props {
  readonly id: string;
  readonly group: TileGroup;
  readonly index: number;
  readonly count: number;
}

const iconBtn = 'rounded-md p-1 text-slate-400 hover:bg-panel-hi hover:text-slate-100 disabled:opacity-30';

/** Edit-mode heading for a dashboard group: rename, reorder, dissolve. */
export function GroupHeading({ id, group, index, count }: Props) {
  const { updateGroup, moveGroup, removeGroup } = useLayoutStore.getState();
  return (
    <div className="flex items-center gap-1">
      <h2 id={id} className="sr-only">
        {group.name}
      </h2>
      <input
        value={group.name}
        onChange={(e) => updateGroup('dashboard', group.id, { name: e.target.value })}
        aria-label="Group name"
        className="min-w-0 max-w-xs flex-1 rounded-lg border border-line bg-panel px-2 py-1 text-sm font-semibold uppercase tracking-wider text-slate-200 outline-none focus:border-accent"
      />
      <select
        value={group.width}
        onChange={(e) => updateGroup('dashboard', group.id, { width: WIDTHS.find((w) => w === e.target.value) ?? 'full' })}
        aria-label="Group width"
        title="Narrower groups sit side by side on wide windows"
        className="rounded-lg border border-line bg-panel px-1.5 py-1 text-xs text-slate-200"
      >
        <option value="full">Full width</option>
        <option value="twothirds">Two-thirds width</option>
        <option value="half">Half width</option>
        <option value="third">Third width</option>
      </select>
      <button type="button" className={iconBtn} disabled={index === 0} onClick={() => moveGroup('dashboard', group.id, -1)} aria-label="Move group up">
        <ArrowUp className="h-4 w-4" />
      </button>
      <button type="button" className={iconBtn} disabled={index === count - 1} onClick={() => moveGroup('dashboard', group.id, 1)} aria-label="Move group down">
        <ArrowDown className="h-4 w-4" />
      </button>
      {isWidgetGroup(group) ? (
        <NowPlayingToggle />
      ) : (
        <button
          type="button"
          className={iconBtn}
          onClick={() => removeGroup('dashboard', group.id)}
          title="Remove group (its tiles go back to their usual sections)"
          aria-label={`Remove group ${group.name}`}
        >
          <Ungroup className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/** The Now Playing card can't be removed, only hidden. */
function NowPlayingToggle() {
  const visible = useNowPlayingStore((s) => s.visible);
  const { setVisible } = useNowPlayingStore.getState();
  return (
    <button
      type="button"
      onClick={() => setVisible(!visible)}
      aria-pressed={!visible}
      title={visible ? 'Hide the Now Playing card' : 'Show the Now Playing card'}
      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-panel-hi hover:text-slate-100"
    >
      {visible ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
      {visible ? 'Hide' : 'Show'}
    </button>
  );
}
