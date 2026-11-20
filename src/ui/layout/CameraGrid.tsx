import { useMemo, useRef, type CSSProperties } from 'react';
import type { CameraStream } from '../../core/types';
import { applyOrder, useLayoutStore, withName, type GroupWidth } from '../../state/layoutStore';
import { useViewStore } from '../../state/viewStore';
import { UnifiVideoTile } from '../video/UnifiVideoTile';
import { EditChrome } from './EditChrome';
import { useSortable } from './useSortable';
import { useSpanResize } from './useSpanResize';

type SpanStyle = CSSProperties & { '--span'?: number };

/** Default tile width when the user hasn't resized it, by group width. */
const DEFAULT_SPAN: Record<GroupWidth, string> = {
  full: 'sm:col-span-6 2xl:col-span-3',
  twothirds: 'sm:col-span-6 2xl:col-span-4',
  half: 'sm:col-span-6 lg:col-span-12 2xl:col-span-6',
  third: 'sm:col-span-6 lg:col-span-12',
};

/**
 * Camera tiles on a 12-column grid. Each tile can span 3–12 columns (saved per
 * camera; default is 2 per row, 4 per row on very wide windows). In edit mode
 * tiles can be dragged to reorder and resized from the corner handle.
 */
export function CameraGrid({ cameras, width = 'full' }: { cameras: readonly CameraStream[]; width?: GroupWidth }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const order = useLayoutStore((s) => s.order);
  const names = useLayoutStore((s) => s.names);
  const spans = useLayoutStore((s) => s.spans);
  const editing = useLayoutStore((s) => s.editing);
  const selected = useLayoutStore((s) => s.selected);
  const { reorder, setSpan, toggleSelected } = useLayoutStore.getState();
  const pips = useViewStore((s) => s.pips);
  const fullscreenUid = useViewStore((s) => s.fullscreenUid);
  const { openPip, setFullscreen } = useViewStore.getState();

  const ordered = useMemo(() => applyOrder(cameras, order), [cameras, order]);
  const byUid = useMemo(() => new Map(cameras.map((c) => [c.uid, c])), [cameras]);
  const popped = useMemo(() => new Set(pips.map((p) => p.uid)), [pips]);
  const sortable = useSortable(gridRef, useMemo(() => ordered.map((c) => c.uid), [ordered]), reorder);
  const resize = useSpanResize(gridRef, setSpan);

  return (
    <div ref={gridRef} className="grid grid-flow-dense grid-cols-1 gap-4 sm:grid-cols-12">
      {sortable.ids.map((uid) => {
        const original = byUid.get(uid);
        if (!original) return null;
        const c = withName(original, names);
        const span = resize.previewSpan(uid) ?? spans[uid];
        const style: SpanStyle | undefined = span ? { '--span': span } : undefined;
        return (
          <div
            key={uid}
            data-sort-id={uid}
            style={style}
            className={`relative self-start ${span ? 'sm:col-span-(--span)' : DEFAULT_SPAN[width]} ${sortable.dragging === uid ? 'opacity-60' : ''}`}
          >
            <UnifiVideoTile
              camera={c}
              // Slightly wider than 16:9 so dashboard pages fit more; fullscreen and popups show the full frame.
              aspect="aspect-[2/1]"
              // A camera already shown in a popup or fullscreen doesn't stream twice.
              suspended={fullscreenUid !== null || popped.has(uid)}
              onPip={() => openPip(uid)}
              onFullscreen={() => setFullscreen(uid)}
            />
            {editing && (
              <EditChrome uid={uid} name={c.name} defaultName={original.name} selected={selected.has(uid)} onToggle={() => toggleSelected(uid)} sortable={sortable}>
                <button
                  type="button"
                  aria-label={`Resize ${c.name} (double-click to reset)`}
                  title="Drag to resize · double-click to reset"
                  className="absolute bottom-0 right-0 hidden h-6 w-6 cursor-ew-resize touch-none rounded-br-xl sm:block"
                  style={{ background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.55) 50%)' }}
                  {...resize.handleProps(uid)}
                />
                {resize.resizing === uid && span && (
                  <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
                    {span} / 12
                  </span>
                )}
              </EditChrome>
            )}
          </div>
        );
      })}
    </div>
  );
}
