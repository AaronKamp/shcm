import { useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';

/**
 * Pointer-driven reordering for a grid of `[data-sort-id]` children. HTML5
 * drag-and-drop is unusable here: Tauri's native file-drop handler swallows it
 * on Windows. Items reorder live under the pointer; the order is committed on drop.
 */
export interface Sortable {
  /** Ids in display order (live while dragging). */
  readonly ids: readonly string[];
  readonly dragging: string | null;
  handleProps: (id: string) => {
    onPointerDown: (e: PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: PointerEvent<HTMLElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  };
}

const move = (ids: readonly string[], id: string, to: number): string[] => {
  const out = ids.filter((x) => x !== id);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, id);
  return out;
};

const hitTest = (container: HTMLElement, x: number, y: number): string | null => {
  for (const el of container.querySelectorAll<HTMLElement>('[data-sort-id]')) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el.dataset['sortId'] ?? null;
  }
  return null;
};

export const useSortable = (
  container: RefObject<HTMLElement | null>,
  ids: readonly string[],
  onCommit: (ids: readonly string[]) => void,
): Sortable => {
  const [preview, setPreview] = useState<readonly string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const live = useRef<readonly string[] | null>(null);
  // After a swap, ignore that same target until the pointer leaves it (stops
  // flip-flopping between tiles of different sizes).
  const lastSwap = useRef<string | null>(null);

  const finish = (): void => {
    const next = live.current;
    live.current = null;
    lastSwap.current = null;
    setDragging(null);
    setPreview(null);
    if (next && next.join() !== ids.join()) onCommit(next);
  };

  return {
    ids: preview ?? ids,
    dragging,
    handleProps: (id) => ({
      onPointerDown: (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        live.current = [...ids];
        setPreview(live.current);
        setDragging(id);
      },
      onPointerMove: (e) => {
        const current = live.current;
        if (!current || !container.current) return;
        const target = hitTest(container.current, e.clientX, e.clientY);
        if (target === null || target === id) {
          lastSwap.current = null;
          return;
        }
        if (target === lastSwap.current) return;
        lastSwap.current = target;
        live.current = move(current, id, current.indexOf(target));
        setPreview(live.current);
      },
      onPointerUp: finish,
      onPointerCancel: finish,
      onKeyDown: (e) => {
        const delta = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
        if (!delta) return;
        e.preventDefault();
        onCommit(move(ids, id, ids.indexOf(id) + delta));
      },
    }),
  };
};
