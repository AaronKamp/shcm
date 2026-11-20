import { useMemo } from 'react';
import type { CameraStream, SmartEntity } from '../../core/types';
import { useDeviceStore } from '../../state/deviceStore';
import { useLayoutStore, withName } from '../../state/layoutStore';
import { isDashboardEntity } from '../dashboardEntities';

/** Anything that can be placed in a group. Names include the user's renames. */
export type OverlayItem =
  | { readonly kind: 'camera'; readonly uid: string; readonly name: string; readonly camera: CameraStream }
  | { readonly kind: 'entity'; readonly uid: string; readonly name: string; readonly entity: SmartEntity };

/** Cameras first, then devices (cameras are shown as video, not as camera entities). */
export const useOverlayItems = (): { readonly list: readonly OverlayItem[]; readonly byUid: ReadonlyMap<string, OverlayItem> } => {
  const cameras = useDeviceStore((s) => s.cameras);
  const entities = useDeviceStore((s) => s.entities);
  const names = useLayoutStore((s) => s.names);
  return useMemo(() => {
    const list: OverlayItem[] = [
      ...cameras.map((c): OverlayItem => {
        const camera = withName(c, names);
        return { kind: 'camera', uid: camera.uid, name: camera.name, camera };
      }),
      ...entities
        .filter(isDashboardEntity)
        .map((e): OverlayItem => {
          const entity = withName(e, names);
          return { kind: 'entity', uid: entity.uid, name: entity.name, entity };
        }),
    ];
    return { list, byUid: new Map(list.map((i) => [i.uid, i])) };
  }, [cameras, entities, names]);
};

export const itemSubtitle = (item: OverlayItem): string =>
  item.kind === 'camera' ? 'Camera' : [item.entity.area, item.entity.domain.replace(/_/g, ' ')].filter(Boolean).join(' · ');
