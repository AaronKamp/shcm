import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePageGestures } from './usePageGestures';

export interface Block {
  readonly key: string;
  /** Columns of the 6-column grid this block takes on wide windows. */
  readonly span: number;
  readonly node: ReactNode;
}

const GAP = 24; // gap-6
/** Header element the page dots render into. */
export const PAGE_DOTS_ID = 'page-dots';
const WIDE = '(min-width: 1024px)'; // Tailwind lg, where the 6-column grid applies
const COLS = 6;
/** Space kept clear at the page bottom for the floating page dots (pb-9). */
const DOTS_CLEARANCE = 36;

interface Placed {
  readonly block: Block;
  readonly col: number;
  readonly span: number;
  readonly top: number;
}
interface Page {
  readonly items: Placed[];
  height: number;
}

/** CSS for column `col`'s left edge or a `span`-column width, as a share of the page width. */
const colCalc = (n: number, extraGaps: number): string => `calc((100% - ${(COLS - 1) * GAP}px) / ${COLS} * ${n} + ${extraGaps * GAP}px)`;

const useWide = (): boolean => {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches);
  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const on = (): void => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
};

/**
 * Column packing (masonry): in order, each block goes where its columns are
 * free highest up, so a short group leaves room underneath for the next one
 * instead of the whole row waiting on its tallest member. A block that would
 * run past the page bottom starts a new page; one taller than a page gets a
 * page of its own, which scrolls.
 */
const pack = (blocks: readonly Block[], heights: ReadonlyMap<string, number>, pageHeight: number, wide: boolean): Page[] => {
  const pages: Page[] = [];
  let free = new Array<number>(COLS).fill(0);
  let page: Page = { items: [], height: 0 };
  const spot = (span: number): { col: number; top: number } => {
    let best = { col: 0, top: Infinity };
    for (let c = 0; c + span <= COLS; c++) {
      const top = Math.max(...free.slice(c, c + span));
      if (top < best.top) best = { col: c, top };
    }
    return best;
  };
  for (const block of blocks) {
    const span = wide ? Math.min(COLS, block.span) : COLS;
    const h = heights.get(block.key) ?? 0;
    let at = spot(span);
    if (page.items.length > 0 && at.top + h > pageHeight) {
      pages.push(page);
      page = { items: [], height: 0 };
      free = new Array<number>(COLS).fill(0);
      at = spot(span);
    }
    page.items.push({ block, col: at.col, span, top: at.top });
    const bottom = at.top + h;
    for (let c = at.col; c < at.col + span; c++) free[c] = bottom + GAP;
    page.height = Math.max(page.height, bottom);
  }
  pages.push(page);
  return pages;
};

/**
 * Dashboard sections as horizontal pages. Swipe or drag anywhere that isn't a
 * tile or control, scroll sideways on a trackpad, or use the dots to change page.
 */
export function PagedSections({ blocks, bottomInset }: { blocks: readonly Block[]; bottomInset: boolean }) {
  const viewport = useRef<HTMLDivElement>(null);
  const wide = useWide();
  const [pageHeight, setPageHeight] = useState(0);
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map());
  const observed = useRef(new Map<Element, string>());
  const observer = useRef<ResizeObserver | null>(null);

  // Section heights, measured where they're shown (width doesn't depend on the page).
  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      setHeights((prev) => {
        let next: Map<string, number> | null = null;
        for (const e of entries) {
          const key = observed.current.get(e.target);
          const h = Math.round(e.borderBoxSize[0]?.blockSize ?? e.contentRect.height);
          if (key && prev.get(key) !== h) (next ??= new Map(prev)).set(key, h);
        }
        return next ?? prev;
      });
    });
    observer.current = ro;
    for (const el of observed.current.keys()) ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPageHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const measure = (key: string) => (el: HTMLDivElement | null): void => {
    for (const [node, k] of observed.current) {
      if (k === key && node !== el) {
        observer.current?.unobserve(node);
        observed.current.delete(node);
      }
    }
    if (el && !observed.current.has(el)) {
      observed.current.set(el, key);
      observer.current?.observe(el);
    }
  };

  // Top padding plus what's floating at the bottom (the page dots, or the editor bar while editing) come out of the usable height.
  const usable = Math.max(200, pageHeight - 12 - (bottomInset ? 84 : DOTS_CLEARANCE));
  const pages = useMemo(() => pack(blocks, heights, usable, wide), [blocks, heights, usable, wide]);
  const { page, setPage, dragX, handlers } = usePageGestures(pages.length, viewport);
  // The page dots live in the header (see Dashboard's #page-dots), so they never cover tiles or cost height.
  const [dotsHost, setDotsHost] = useState<HTMLElement | null>(null);
  useEffect(() => setDotsHost(document.getElementById(PAGE_DOTS_ID)), []);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={viewport} className="h-full touch-pan-y overflow-hidden" {...handlers}>
        <div
          className={`flex h-full ${dragX === 0 ? 'transition-transform duration-300 ease-out' : ''}`}
          style={{ transform: `translateX(calc(${-page * 100}% + ${dragX}px))` }}
        >
          {pages.map((p, i) => (
            <div
              key={i}
              aria-hidden={i !== page}
              inert={i !== page}
              className={`h-full w-full shrink-0 overflow-y-auto px-4 pt-3 sm:px-6 ${bottomInset ? 'pb-[84px]' : 'pb-9'}`}
            >
              <div className="relative" style={{ height: p.height }}>
                {p.items.map(({ block, col, span, top }) => (
                  <div
                    key={block.key}
                    ref={measure(block.key)}
                    data-block={block.key}
                    className="absolute min-w-0"
                    style={{ top, left: colCalc(col, col), width: colCalc(span, span - 1) }}
                  >
                    {block.node}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      {pages.length > 1 &&
        (() => {
          const dots = (
            <nav aria-label="Pages" className="flex items-center gap-1.5 rounded-full bg-panel/95 px-2.5 py-1.5 shadow-lg ring-1 ring-line backdrop-blur">
              {pages.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPage(i)}
                  aria-label={`Page ${i + 1} of ${pages.length}`}
                  aria-current={i === page ? 'page' : undefined}
                  className={`h-2 rounded-full transition-all ${i === page ? 'w-5 bg-accent' : 'w-2 bg-slate-500 hover:bg-slate-300'}`}
                />
              ))}
            </nav>
          );
          // Floating at the bottom; while editing, the editor bar owns the bottom so the dots go to the header.
          if (bottomInset) return dotsHost ? createPortal(dots, dotsHost) : null;
          return <div className="pointer-events-none absolute inset-x-0 bottom-2 z-20 flex justify-center [&>nav]:pointer-events-auto">{dots}</div>;
        })()}
    </div>
  );
}
