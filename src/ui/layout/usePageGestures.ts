import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

/** Swipes don't start on tiles or controls, so sliders, buttons and video keep their own gestures. */
const NO_SWIPE = 'button, a, input, select, textarea, label, video, [data-tile], [role="dialog"], [role="slider"], [contenteditable="true"]';
/** Distance that commits a page change (or a fraction of the width, whichever is smaller). */
const COMMIT_PX = 80;
/** Movement before a press counts as a swipe rather than a click. */
const SLOP_PX = 8;
const WHEEL_COMMIT = 60;
const WHEEL_COOLDOWN_MS = 450;

/**
 * Page index plus drag/wheel/keyboard handling for the page carousel:
 * - drag (mouse) or swipe (touch/pen) horizontally on empty space;
 * - sideways trackpad scroll or Shift+wheel;
 * - Ctrl+Left / Ctrl+Right.
 */
export const usePageGestures = (count: number, viewport: RefObject<HTMLDivElement | null>) => {
  const [page, setPageRaw] = useState(0);
  const [dragX, setDragX] = useState(0);
  const drag = useRef<{ id: number; x: number; y: number; active: boolean } | null>(null);
  const wheel = useRef({ sum: 0, until: 0 });

  const setPage = (p: number): void => setPageRaw(Math.max(0, Math.min(count - 1, p)));

  // Fewer pages after a resize or layout change: stay in range.
  useEffect(() => {
    if (page > count - 1) setPageRaw(Math.max(0, count - 1));
  }, [count, page]);

  // Sideways wheel: needs a non-passive listener to stop the browser's own handling.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      if (dx === 0) return;
      e.preventDefault();
      const now = performance.now();
      if (now < wheel.current.until) return;
      wheel.current.sum += dx;
      if (Math.abs(wheel.current.sum) >= WHEEL_COMMIT) {
        setPageRaw((p) => Math.max(0, Math.min(count - 1, p + Math.sign(wheel.current.sum))));
        wheel.current = { sum: 0, until: now + WHEEL_COOLDOWN_MS };
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [viewport, count]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      setPageRaw((p) => Math.max(0, Math.min(count - 1, p + (e.key === 'ArrowRight' ? 1 : -1))));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count]);

  const onPointerDown = (e: ReactPointerEvent): void => {
    if (count < 2 || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.target instanceof Element && e.target.closest(NO_SWIPE)) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, active: false };
  };

  const onPointerMove = (e: ReactPointerEvent): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.active) {
      if (Math.abs(dy) > SLOP_PX && Math.abs(dy) > Math.abs(dx)) {
        drag.current = null; // vertical: let the page scroll
        return;
      }
      if (Math.abs(dx) < SLOP_PX) return;
      d.active = true;
      try {
        viewport.current?.setPointerCapture(e.pointerId);
      } catch {
        // The pointer already ended (or was synthetic); the drag still works without capture.
      }
    }
    // Resist past the first/last page.
    const edge = (page === 0 && dx > 0) || (page === count - 1 && dx < 0);
    setDragX(edge ? dx / 3 : dx);
  };

  const end = (e: ReactPointerEvent): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.active) return;
    const dx = e.clientX - d.x;
    const width = viewport.current?.clientWidth ?? 1000;
    if (Math.abs(dx) >= Math.min(COMMIT_PX, width / 4)) setPage(page + (dx < 0 ? 1 : -1));
    setDragX(0);
  };

  return {
    page: Math.min(page, Math.max(0, count - 1)),
    setPage,
    dragX,
    handlers: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end },
  };
};
