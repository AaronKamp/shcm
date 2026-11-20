import type { SmartEntity } from '../../core/types';
import { useNow } from '../useNow';
import type { OverlayTone } from './contrast';
import { temperature, weatherLook } from './weatherIcon';

/** Where the time/weather bar sits for the current photo; changes each photo against burn-in. */
export interface OverlayPlacement {
  readonly band: 'top' | 'bottom';
  /** Time on the right, weather on the left. */
  readonly swapped: boolean;
  /** Small offsets (px) so even the same band never lands on the same pixels. */
  readonly dx: number;
  readonly dy: number;
  readonly tone: OverlayTone;
  /** 0–0.6 gradient scrim behind the text. */
  readonly scrim: number;
}

interface Props {
  readonly placement: OverlayPlacement;
  readonly weather: SmartEntity | undefined;
  readonly night: boolean;
  readonly clock24: boolean;
  /** Fades out while the bar moves to its next spot. */
  readonly shown: boolean;
}

/** Time on one side, current conditions on the other, legible over any photo. */
export function InfoOverlay({ placement, weather, night, clock24, shown }: Props) {
  const now = useNow();
  const { band, swapped, dx, dy, tone, scrim } = placement;
  const dark = tone === 'dark';
  const text = dark ? 'text-slate-900' : 'text-white';
  const shadow = dark ? '0 1px 12px rgba(255,255,255,.55)' : '0 2px 16px rgba(0,0,0,.6), 0 1px 3px rgba(0,0,0,.5)';
  const scrimColor = dark ? '255,255,255' : '0,0,0';
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !clock24 });
  const date = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  const look = weather && weather.available ? weatherLook(weather.state, night) : null;
  const temp = weather ? temperature(weather) : null;

  const clock = (
    <div className={swapped ? 'text-right' : 'text-left'}>
      <div className="text-7xl font-light leading-none tracking-tight tabular-nums sm:text-8xl">{time}</div>
      <div className="mt-2 text-xl font-normal opacity-90">{date}</div>
    </div>
  );
  const conditions = look && (
    <div className={`flex items-center gap-4 ${swapped ? '' : 'flex-row-reverse text-right'}`}>
      <look.icon className="h-20 w-20 shrink-0 stroke-[1.25]" aria-hidden style={{ filter: `drop-shadow(${shadow.split(', ')[0] ?? ''})` }} />
      <div>
        {temp && <div className="text-5xl font-light leading-none tabular-nums">{temp}</div>}
        <div className="mt-1 text-xl capitalize opacity-90">{look.label}</div>
      </div>
    </div>
  );

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 ${band === 'top' ? 'top-0' : 'bottom-0'} transition-opacity duration-700 ${shown ? 'opacity-100' : 'opacity-0'}`}
      style={{
        background: `linear-gradient(${band === 'top' ? 'to bottom' : 'to top'}, rgba(${scrimColor},${scrim}) 0%, rgba(${scrimColor},${scrim * 0.6}) 55%, rgba(${scrimColor},0) 100%)`,
      }}
    >
      <div
        className={`flex items-end justify-between gap-8 px-12 ${band === 'top' ? 'pb-24 pt-10' : 'pb-10 pt-24'} ${text}`}
        style={{ textShadow: shadow, transform: `translate(${dx}px, ${dy}px)` }}
      >
        {swapped ? (
          <>
            {conditions ?? <span />}
            {clock}
          </>
        ) : (
          <>
            {clock}
            {conditions ?? <span />}
          </>
        )}
      </div>
    </div>
  );
}
