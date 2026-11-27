import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

const HOLD_MS = 550;
const SLOP_PX = 10;

/**
 * Pointer handlers that call `onLong` after a press held still for ~half a
 * second. Right-click and the keyboard's menu key (contextmenu) do the same.
 */
export function useLongPress(onLong: () => void) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cancel = (): void => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    start.current = null;
  };
  useEffect(() => cancel, []);

  return {
    onPointerDown: (e: ReactPointerEvent): void => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      cancel();
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        cancel();
        onLong();
      }, HOLD_MS);
    },
    onPointerMove: (e: ReactPointerEvent): void => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > SLOP_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e: { preventDefault: () => void }): void => {
      e.preventDefault();
      cancel();
      onLong();
    },
  };
}
