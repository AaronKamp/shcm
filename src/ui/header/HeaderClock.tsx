import { useMemo } from 'react';
import { useDeviceStore } from '../../state/deviceStore';
import { useScreensaverStore } from '../../state/screensaverStore';
import { isNight, pickWeather } from '../screensaver/sensors';
import { temperature, weatherLook } from '../screensaver/weatherIcon';
import { useNow } from '../useNow';

/** Current conditions then the time, for the header. Uses the screensaver's weather and 24-hour settings. */
export function HeaderClock() {
  const now = useNow();
  const entities = useDeviceStore((s) => s.entities);
  const weatherSetting = useScreensaverStore((s) => s.weather);
  const clock24 = useScreensaverStore((s) => s.clock24);
  const weather = useMemo(() => pickWeather(entities, weatherSetting), [entities, weatherSetting]);
  const look = weather?.available ? weatherLook(weather.state, isNight(entities, now)) : null;
  const temp = weather?.available ? temperature(weather) : null;
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !clock24 });
  const date = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="flex items-center gap-3 text-slate-200">
      {look && (
        <span className="flex items-center gap-1.5 text-sm" title={`${weather?.name ?? 'Weather'}: ${look.label}`}>
          <look.icon className="h-5 w-5 text-slate-300" aria-hidden />
          {temp && <span className="tabular-nums">{temp}</span>}
          <span className="sr-only">{look.label}</span>
        </span>
      )}
      <time dateTime={now.toISOString()} title={date} className="text-sm font-medium tabular-nums">
        {time}
      </time>
    </div>
  );
}
