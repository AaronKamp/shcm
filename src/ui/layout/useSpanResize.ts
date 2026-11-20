import { useRef, useState, type PointerEvent, type RefObject } from 'react';
import { SPAN_MAX, SPAN_MIN } from '../../state/layoutStore';

/**
 * Drag a tile's corner to change how many of the grid's 12 columns it spans.
 * Height follows from the tile's 16:9 aspect. No-op when the grid is a single
 * column (narrow windows), where every tile is full width anyway.
 */
export interface SpanResize {
  /** Live span for `uid` while resizing it, else null. */
  readonly previewSpan: (uid: string) => number | null;
  readonly resizing: string | null;
  handleProps: (uid: string) => {
    onPointerDown: (e: PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: PointerEvent<HTMLElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onDoubleClick: () => void;
  };
}

interface Drag {
  readonly uid: string;
  readonly left: number;
  readonly col: number;
  readonly gap: number;
}

const gridMetrics = (grid: HTMLElement): { cols: number; col: number; gap: number } => {
  const style = getComputedStyle(grid);
  const cols = style.gridTemplateColumns.split(' ').filter(Boolean).length;
  const gap = parseFloat(style.columnGap) || 0;
  return { cols, gap, col: (grid.clientWidth - gap * (cols - 1)) / Math.max(1, cols) };
};

export const useSpanResize = (
  grid: RefObject<HTMLElement | null>,
  onCommit: (uid: string, span: number | null) => void,
): SpanResize => {
  const drag = useRef<Drag | null>(null);
  const [live, setLive] = useState<{ uid: string; span: number } | null>(null);

  const liveRef = useRef<{ uid: string; span: number } | null>(null);

  const finish = (): void => {
    const l = liveRef.current;
    drag.current = null;
    liveRef.current = null;
    setLive(null);
    if (l) onCommit(l.uid, l.span);
  };

  return {
    previewSpan: (uid) => (live?.uid === uid ? live.span : null),
    resizing: live?.uid ?? null,
    handleProps: (uid) => ({
      onPointerDown: (e) => {
        if (e.button !== 0 || !grid.current) return;
        const m = gridMetrics(grid.current);
        if (m.cols < SPAN_MAX) return;
        const tile = e.currentTarget.closest<HTMLElement>('[data-sort-id]');
        if (!tile) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { uid, left: tile.getBoundingClientRect().left, col: m.col, gap: m.gap };
      },
      onPointerMove: (e) => {
        const d = drag.current;
        if (!d) return;
        const raw = Math.round((e.clientX - d.left + d.gap) / (d.col + d.gap));
        const span = Math.min(SPAN_MAX, Math.max(SPAN_MIN, raw));
        if (liveRef.current?.span === span) return;
        liveRef.current = { uid: d.uid, span };
        setLive(liveRef.current);
      },
      onPointerUp: finish,
      onPointerCancel: finish,
      // Back to the responsive default width.
      onDoubleClick: () => onCommit(uid, null),
    }),
  };
};
