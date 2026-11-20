import { useDeviceStore } from '../../state/deviceStore';
import { useLayoutStore, type TileGroup } from '../../state/layoutStore';
import { useNowPlayingStore } from '../../state/nowPlayingStore';
import { GroupHeading } from '../layout/GroupHeading';
import { NowPlayingCard } from './NowPlayingCard';
import { ReceiverStrip, useReceiver } from './ReceiverStrip';

const heading = 'text-sm font-semibold uppercase tracking-wider text-slate-400';

interface Props {
  readonly group: TileGroup;
  readonly index: number;
  readonly count: number;
  /** Grid span for the group's width. */
  readonly className: string;
}

/**
 * The Now Playing card in its own dashboard group: renamed, moved and resized
 * from Edit layout like any group, and hidden rather than removed.
 */
export function NowPlayingSection({ group, index, count, className }: Props) {
  const visible = useNowPlayingStore((s) => s.visible);
  const editing = useLayoutStore((s) => s.editing);
  const hasPlayers = useDeviceStore((s) => s.entities.some((e) => e.domain === 'media_player'));
  const { receiver } = useReceiver();
  if (!hasPlayers || (!visible && !editing)) return null;
  const id = `sec-${group.id}`;

  return (
    <section aria-labelledby={id} className={`min-w-0 space-y-3 ${className}`}>
      <div className="flex min-h-8 items-center gap-2">
        {editing ? (
          <GroupHeading id={id} group={group} index={index} count={count} />
        ) : (
          <h2 id={id} className={heading}>
            {group.name || 'Now Playing'}
          </h2>
        )}
      </div>
      {visible ? <NowPlayingCard /> : <p className="rounded-xl border border-dashed border-line p-4 text-xs text-slate-500">Hidden. Click Show to put it back.</p>}
      {visible && receiver && <ReceiverStrip entity={receiver} />}
    </section>
  );
}
