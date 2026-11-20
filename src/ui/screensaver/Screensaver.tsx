import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { errorMessage } from '../../core/DeviceProvider';
import { listPhotos } from '../../platform/photos';
import { useDeviceStore } from '../../state/deviceStore';
import { setScreensaverActive, useScreensaverStore } from '../../state/screensaverStore';
import { InfoOverlay } from './InfoOverlay';
import { isNight, pickWeather } from './sensors';
import { FADE_MS, useSlideshow, type Slide } from './useSlideshow';

/** Rescanned each time the screensaver starts, so new photos show up (the scan reads folder metadata only). */
const usePhotoList = (folders: readonly string[], recursive: boolean, links: readonly string[]): { urls: string[]; error: string | null } => {
  const [state, setState] = useState<{ urls: string[]; error: string | null }>({ urls: [], error: null });
  useEffect(() => {
    let live = true;
    listPhotos({ folders, recursive, links }).then(
      (res) => live && setState({ urls: res.urls, error: null }),
      (err: unknown) => live && setState({ urls: [], error: errorMessage(err) }),
    );
    return () => {
      live = false;
    };
  }, [folders, recursive, links]);
  return state;
};

function SlideLayer({ slide, durationMs }: { readonly slide: Slide; readonly durationMs: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fade = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease-in-out', fill: 'forwards' });
    const drift = el.animate([{ transform: slide.motion.from }, { transform: slide.motion.to }], { duration: durationMs, easing: 'linear', fill: 'forwards' });
    return () => {
      fade.cancel();
      drift.cancel();
    };
  }, [slide, durationMs]);
  return (
    <div ref={ref} className="absolute inset-0 opacity-0" style={{ willChange: 'transform, opacity' }}>
      {slide.fit === 'contain' && (
        <img src={slide.url} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover blur-3xl brightness-50" />
      )}
      <img src={slide.url} alt="" className={`absolute inset-0 h-full w-full ${slide.fit === 'contain' ? 'object-contain' : 'object-cover'}`} />
    </div>
  );
}

/** Mouse travel (px) that counts as "someone's here"; filters out a bumped desk. */
const MOVE_WAKE_PX = 24;

/** Full-window photo slideshow with time and weather. Any input dismisses it without clicking through. */
export function Screensaver() {
  const folders = useScreensaverStore((s) => s.folders);
  const recursive = useScreensaverStore((s) => s.includeSubfolders);
  const intervalSec = useScreensaverStore((s) => s.intervalSec);
  const weatherSetting = useScreensaverStore((s) => s.weather);
  const clock24 = useScreensaverStore((s) => s.clock24);
  const entities = useDeviceStore((s) => s.entities);
  const weather = useMemo(() => pickWeather(entities, weatherSetting), [entities, weatherSetting]);
  const links = useScreensaverStore((s) => s.links);
  const { urls, error } = usePhotoList(folders, recursive, links);
  const intervalMs = intervalSec * 1000;
  const { slides, placement, overlayShown } = useSlideshow(urls, intervalMs);
  const moved = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      setScreensaverActive(false);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);

  // Dismiss after the gesture ends so the trailing click lands here, not on a tile underneath.
  const dismissSoon = (e: PointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    setTimeout(() => setScreensaverActive(false), 60);
  };
  const onMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') return;
    moved.current += Math.abs(e.movementX) + Math.abs(e.movementY);
    if (moved.current > MOVE_WAKE_PX) setScreensaverActive(false);
  };

  return (
    <div
      className="fixed inset-0 z-[90] cursor-none select-none overflow-hidden bg-black"
      role="presentation"
      onPointerDown={(e) => e.preventDefault()}
      onPointerUp={dismissSoon}
      onPointerMove={onMove}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {slides.map((s) => (
        <SlideLayer key={s.key} slide={s} durationMs={intervalMs + FADE_MS * 2} />
      ))}
      <InfoOverlay placement={placement} weather={weather} night={isNight(entities, new Date())} clock24={clock24} shown={overlayShown} />
      {!urls.length && (
        <p
          className="absolute left-1/2 top-1/2 text-sm text-slate-500"
          style={{ transform: `translate(calc(-50% + ${placement.dx * 3}px), calc(-50% + ${placement.dy * 4}px))` }}
        >
          {error ? `Couldn't read photo folders: ${error}` : folders.length || links.length ? 'Loading photos…' : 'Add photo folders or shared albums in Settings → Screensaver'}
        </p>
      )}
    </div>
  );
}

/** Mounted by the dashboard; renders only while the screensaver runs. */
export function ScreensaverHost() {
  const active = useScreensaverStore((s) => s.active);
  return active ? <Screensaver /> : null;
}
