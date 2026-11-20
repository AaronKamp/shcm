import { useMemo } from 'react';
import type { CameraStream, SmartEntity } from '../../core/types';
import { useDeviceStore } from '../../state/deviceStore';
import { isLightLike, useLayoutStore, useLightSwitchPrefs, type GroupWidth, type TileGroup } from '../../state/layoutStore';
import { isDashboardEntity } from '../dashboardEntities';
import { CameraGrid } from './CameraGrid';
import { EntityGrid } from './EntityGrid';
import { GroupHeading } from './GroupHeading';
import { MasterLights } from './MasterLights';
import { PagedSections, type Block } from './PagedSections';
import { NowPlayingSection } from '../nowplaying/NowPlayingSection';
import { isWidgetGroup } from '../../state/layoutPersist';

interface Section {
  readonly key: string;
  readonly title: string;
  readonly group?: TileGroup;
  readonly index?: number;
  readonly cameras: readonly CameraStream[];
  readonly entities: readonly SmartEntity[];
}

const heading = 'text-sm font-semibold uppercase tracking-wider text-slate-400';

/** Group width on wide (lg+) windows, in columns of the 6-column section grid. */
const SPAN: Record<GroupWidth, number> = { full: 6, twothirds: 4, half: 3, third: 2 };

/**
 * Dashboard body: the user's groups first, then ungrouped cameras, then
 * ungrouped devices by area. Hidden tiles are left out entirely (so hidden
 * cameras don't stream).
 */
export function DashboardSections() {
  const cameras = useDeviceStore((s) => s.cameras);
  const entities = useDeviceStore((s) => s.entities);
  const groups = useLayoutStore((s) => s.dashboardGroups);
  const hidden = useLayoutStore((s) => s.hidden);
  const editing = useLayoutStore((s) => s.editing);
  const lightPrefs = useLightSwitchPrefs();

  const sections = useMemo((): Section[] => {
    const hide = new Set(hidden);
    const cams = new Map(cameras.filter((c) => !hide.has(c.uid)).map((c) => [c.uid, c]));
    const ents = new Map(entities.filter((e) => isDashboardEntity(e) && !hide.has(e.uid)).map((e) => [e.uid, e]));
    const grouped = new Set(groups.flatMap((g) => g.items));

    const out: Section[] = groups.map((g, index) => ({
      key: g.id,
      title: g.name,
      group: g,
      index,
      cameras: g.items.flatMap((u) => cams.get(u) ?? []),
      entities: g.items.flatMap((u) => ents.get(u) ?? []),
    }));

    const looseCams = [...cams.values()].filter((c) => !grouped.has(c.uid));
    if (looseCams.length) out.push({ key: 'cameras', title: 'Cameras', cameras: looseCams, entities: [] });

    const areas = new Map<string, SmartEntity[]>();
    for (const e of ents.values()) {
      if (grouped.has(e.uid)) continue;
      const area = e.area ?? 'Other';
      const list = areas.get(area);
      if (list) list.push(e);
      else areas.set(area, [e]);
    }
    for (const [area, list] of [...areas.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      out.push({ key: `area:${area}`, title: area, cameras: [], entities: list });
    }
    return out;
  }, [cameras, entities, groups, hidden]);

  const blocks = sections.flatMap((s): Block[] => {
    const span = SPAN[s.group?.width ?? 'full'];
    if (s.group && isWidgetGroup(s.group)) {
      return [{ key: s.key, span, node: <NowPlayingSection group={s.group} index={s.index ?? 0} count={groups.length} className="" /> }];
    }
    const empty = s.cameras.length === 0 && s.entities.length === 0;
    if (empty && !(editing && s.group)) return [];
    const id = `sec-${s.key}`;
    const lights = s.entities.filter((e) => isLightLike(e, lightPrefs));
    return [
      {
        key: s.key,
        span,
        node: (
          <section aria-labelledby={id} className="min-w-0 space-y-3">
            <div className="flex min-h-8 flex-wrap items-center gap-2">
              {s.group && editing ? (
                <GroupHeading id={id} group={s.group} index={s.index ?? 0} count={groups.length} />
              ) : (
                <h2 id={id} className={heading}>
                  {s.title || 'Untitled'}
                </h2>
              )}
              {lights.length >= 2 && <MasterLights lights={lights} />}
            </div>
            {s.cameras.length > 0 && <CameraGrid cameras={s.cameras} width={s.group?.width ?? 'full'} />}
            {s.entities.length > 0 && <EntityGrid entities={s.entities} />}
            {empty && <p className="rounded-xl border border-dashed border-line p-4 text-xs text-slate-500">Empty — select tiles and add them to this group.</p>}
          </section>
        ),
      },
    ];
  });

  return <PagedSections blocks={blocks} bottomInset={editing} />;
}
