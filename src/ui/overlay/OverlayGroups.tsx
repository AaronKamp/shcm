import { Camera, ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CameraStream, SmartEntity } from '../../core/types';
import { isLightLike, useLayoutStore, useLightSwitchPrefs, type OverlayGroup } from '../../state/layoutStore';
import { useViewStore } from '../../state/viewStore';
import { EntityCard } from '../EntityCard';
import { MasterLights } from '../layout/MasterLights';
import { UnifiVideoTile } from '../video/UnifiVideoTile';
import { useOverlayItems } from './items';

/** The overlay body when the user has defined groups. */
export function OverlayGroups({ groups }: { groups: readonly OverlayGroup[] }) {
  const { byUid } = useOverlayItems();
  if (groups.length === 0) {
    return <p className="p-2 text-xs text-slate-500">No overlay groups yet — add some from the dashboard’s Edit layout.</p>;
  }
  return (
    <>
      {groups.map((g) => {
        const cameras: CameraStream[] = [];
        const entities: SmartEntity[] = [];
        for (const uid of g.items) {
          const item = byUid.get(uid);
          if (item?.kind === 'camera') cameras.push(item.camera);
          else if (item?.kind === 'entity') entities.push(item.entity);
        }
        return <Group key={g.id} group={g} cameras={cameras} entities={entities} />;
      })}
    </>
  );
}

function Group({ group, cameras, entities }: { group: OverlayGroup; cameras: readonly CameraStream[]; entities: readonly SmartEntity[] }) {
  const [open, setOpen] = useState(true);
  const pips = useViewStore((s) => s.pips);
  const fullscreenUid = useViewStore((s) => s.fullscreenUid);
  const { openPip, closePip, setFullscreen } = useViewStore.getState();
  const popped = useMemo(() => new Set(pips.map((p) => p.uid)), [pips]);
  const headingId = `og-${group.id}`;
  const lightPrefs = useLightSwitchPrefs();
  const lights = entities.filter((e) => isLightLike(e, lightPrefs));

  return (
    <section aria-labelledby={headingId}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <ChevronDown className={`h-3.5 w-3.5 text-slate-500 transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden />
          <h2 id={headingId} className="truncate text-xs font-semibold uppercase tracking-wider text-slate-400">
            {group.name || 'Untitled'}
          </h2>
        </button>
        {lights.length >= 2 && <MasterLights lights={lights} />}
      </div>
      {open && (
        <div className="space-y-2">
          {cameras.length > 0 &&
            (group.cameraView === 'live' ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {cameras.map((c) => (
                  <UnifiVideoTile
                    key={c.uid}
                    camera={c}
                    suspended={fullscreenUid !== null || popped.has(c.uid)}
                    onPip={() => openPip(c.uid)}
                    onFullscreen={() => setFullscreen(c.uid)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {cameras.map((c) => {
                  const shown = popped.has(c.uid);
                  return (
                    <button
                      key={c.uid}
                      type="button"
                      aria-pressed={shown}
                      onClick={() => (shown ? closePip(c.uid) : openPip(c.uid))}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${shown ? 'border-accent bg-accent/20 text-white' : 'border-line bg-panel text-slate-300 hover:bg-panel-hi'} ${c.online ? '' : 'opacity-50'}`}
                    >
                      <Camera className="h-3.5 w-3.5" aria-hidden />
                      {c.name}
                    </button>
                  );
                })}
              </div>
            ))}
          {entities.length > 0 && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {entities.map((e) => (
                <EntityCard key={e.uid} entity={e} compact />
              ))}
            </div>
          )}
          {cameras.length === 0 && entities.length === 0 && <p className="text-xs text-slate-500">Nothing in this group is available right now.</p>}
        </div>
      )}
    </section>
  );
}
