import { useEffect, useState } from 'react';
import { analyzePhoto, scrimFor, toneFor, type PhotoStats } from './contrast';
import type { OverlayPlacement } from './InfoOverlay';

/** Slow pan/zoom so no part of the photo sits still (burn-in). Transforms as CSS strings. */
export interface KenBurns {
  readonly from: string;
  readonly to: string;
}

export interface Slide {
  readonly key: number;
  readonly url: string;
  /** Photos far from screen shape are letterboxed over a blurred copy instead of cropped. */
  readonly fit: 'cover' | 'contain';
  readonly motion: KenBurns;
}

/** Fade between photos, also the time the overlay is hidden while it moves. */
export const FADE_MS = 1500;
const MAX_SKIPS = 8;

const rand = (min: number, max: number): number => min + Math.random() * (max - min);

const shuffle = <T,>(items: readonly T[]): T[] => {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
};

const kenBurns = (fit: Slide['fit']): KenBurns => {
  const zoom = fit === 'cover' ? 0.08 : 0.04;
  const zoomIn = Math.random() < 0.5;
  const [s0, s1] = zoomIn ? [1.02, 1.02 + zoom] : [1.02 + zoom, 1.02];
  const pan = () => `${rand(-2, 2).toFixed(2)}%, ${rand(-1.5, 1.5).toFixed(2)}%`;
  return { from: `translate(${pan()}) scale(${s0})`, to: `translate(${pan()}) scale(${s1})` };
};

const NEUTRAL: PhotoStats = { top: { luminance: 0.3, busyness: 0.1 }, bottom: { luminance: 0.3, busyness: 0.1 } };

/** Calmest band for the text, never the exact spot it just left, with a small random offset. */
const place = (stats: PhotoStats, prev: OverlayPlacement | null): OverlayPlacement => {
  const options = (['top', 'bottom'] as const)
    .flatMap((band) => [false, true].map((swapped) => ({ band, swapped })))
    .filter((o) => !prev || o.band !== prev.band || o.swapped !== prev.swapped)
    .map((o) => ({ ...o, score: stats[o.band].busyness + Math.random() * 0.06 }))
    .sort((a, b) => a.score - b.score);
  const pick = options[0] ?? { band: 'bottom' as const, swapped: false };
  const b = stats[pick.band];
  const tone = toneFor(b);
  return { band: pick.band, swapped: pick.swapped, dx: Math.round(rand(-40, 40)), dy: Math.round(rand(-20, 20)), tone, scrim: scrimFor(b, tone) };
};

export interface Slideshow {
  readonly slides: readonly Slide[];
  readonly placement: OverlayPlacement;
  readonly overlayShown: boolean;
}

/**
 * Cycles shuffled photos every `intervalMs`, preloading each one and sampling it
 * so the overlay picks a readable spot and tone. Photos that fail to load (e.g.
 * a OneDrive file that's offline) are skipped. With no photos, only the overlay moves.
 */
export function useSlideshow(urls: readonly string[], intervalMs: number): Slideshow {
  const [slides, setSlides] = useState<readonly Slide[]>([]);
  const [placement, setPlacement] = useState<OverlayPlacement>(() => place(NEUTRAL, null));
  const [overlayShown, setOverlayShown] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let order: string[] = [];
    let next = 0;
    let key = 0;
    let last: OverlayPlacement | null = null;

    const show = (stats: PhotoStats): void => {
      const p = place(stats, last);
      last = p;
      setOverlayShown(false);
      setTimeout(() => {
        if (cancelled) return;
        setPlacement(p);
        setOverlayShown(true);
      }, FADE_MS / 2);
    };

    const advance = async (): Promise<void> => {
      for (let tries = 0; tries < MAX_SKIPS && urls.length && !cancelled; tries++) {
        if (next >= order.length) {
          order = shuffle(urls);
          next = 0;
        }
        const url = order[next++];
        if (!url) continue;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = url;
        try {
          await img.decode();
        } catch {
          continue;
        }
        if (cancelled) return;
        const screen = window.innerWidth / Math.max(1, window.innerHeight);
        const fit = Math.abs(Math.log(img.naturalWidth / img.naturalHeight / screen)) > 0.35 ? 'contain' : 'cover';
        show(analyzePhoto(img, screen));
        setSlides((s) => [...s.slice(-1), { key: ++key, url, fit, motion: kenBurns(fit) }]);
        break;
      }
      if (!urls.length) show(NEUTRAL);
      if (!cancelled) timer = setTimeout(() => void advance(), intervalMs);
    };

    void advance();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [urls, intervalMs]);

  return { slides, placement, overlayShown };
}
