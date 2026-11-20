import { Image } from 'lucide-react';
import { useMemo } from 'react';
import { useDeviceStore } from '../../state/deviceStore';
import { updateScreensaver, useScreensaverStore } from '../../state/screensaverStore';
import { PhotoSourcesField } from './PhotoSourcesField';
import { motionCandidates, watchedSensors, weatherEntities } from './sensors';
import { previewScreensaver } from './useScreensaverTrigger';

const IDLE_OPTIONS = [5, 10, 15, 20, 30, 45, 60];
const INTERVAL_OPTIONS = [10, 15, 30, 60, 120, 300];

const select = 'rounded-lg border border-line bg-surface px-2 py-1 text-xs text-slate-100 outline-none focus:border-accent';

/** Away-mode photo screensaver: when it starts, where photos come from, what wakes it. */
export function ScreensaverSettings({ onPreview }: { readonly onPreview: () => void }) {
  const s = useScreensaverStore();
  const entities = useDeviceStore((st) => st.entities);
  const candidates = useMemo(() => motionCandidates(entities), [entities]);
  const watched = useMemo(() => new Set(watchedSensors(entities, s.motionSensors).map((e) => e.uid)), [entities, s.motionSensors]);
  const weathers = useMemo(() => weatherEntities(entities), [entities]);

  const toggleSensor = (uid: string, on: boolean): void => {
    const next = new Set(watched);
    if (on) next.add(uid);
    else next.delete(uid);
    updateScreensaver({ motionSensors: [...next] });
  };

  return (
    <section className="mb-4 rounded-xl border border-line bg-panel p-3" aria-label="Screensaver">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Image className="h-4 w-4 text-slate-400" aria-hidden /> Screensaver
          </span>
          <span className="block text-xs text-slate-500">Photo slideshow with time and weather while nobody’s around.</span>
        </span>
        <button
          type="button"
          onClick={() => {
            onPreview();
            previewScreensaver();
          }}
          className="rounded-lg border border-line px-2.5 py-1 text-xs text-slate-200 hover:bg-panel-hi"
        >
          Preview
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={s.enabled}
          aria-label="Screensaver"
          onClick={() => updateScreensaver({ enabled: !s.enabled })}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${s.enabled ? 'bg-accent' : 'bg-panel-hi'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${s.enabled ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-300">
        <label className="flex items-center gap-1.5">
          Start after
          <select value={s.idleMinutes} onChange={(e) => updateScreensaver({ idleMinutes: Number(e.target.value) })} className={select}>
            {[...new Set([...IDLE_OPTIONS, s.idleMinutes])].sort((a, b) => a - b).map((m) => (
              <option key={m} value={m}>{`${m} min`}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          New photo every
          <select value={s.intervalSec} onChange={(e) => updateScreensaver({ intervalSec: Number(e.target.value) })} className={select}>
            {[...new Set([...INTERVAL_OPTIONS, s.intervalSec])].sort((a, b) => a - b).map((v) => (
              <option key={v} value={v}>{v < 60 ? `${v} s` : `${v / 60} min`}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={s.clock24} onChange={(e) => updateScreensaver({ clock24: e.target.checked })} className="accent-accent" />
          24-hour clock
        </label>
      </div>

      <PhotoSourcesField />

      <fieldset className="mt-3">
        <legend className="mb-1 text-xs text-slate-300">
          Motion that keeps it off and wakes it{' '}
          {s.motionSensors !== null && (
            <button type="button" onClick={() => updateScreensaver({ motionSensors: null })} className="ml-1 text-accent hover:underline">
              Reset to “front” sensors
            </button>
          )}
        </legend>
        {candidates.length ? (
          <ul className="max-h-32 space-y-1 overflow-y-auto pr-1">
            {candidates.map((e) => (
              <li key={e.uid}>
                <label className="flex items-center gap-2 text-xs text-slate-200">
                  <input type="checkbox" checked={watched.has(e.uid)} onChange={(ev) => toggleSensor(e.uid, ev.target.checked)} className="accent-accent" />
                  <span className="truncate">{e.name}</span>
                  {e.area && <span className="text-slate-500">{e.area}</span>}
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500">No motion sensors found. Only touch, mouse and keyboard will count.</p>
        )}
      </fieldset>

      <label className="mt-3 flex items-center gap-1.5 text-xs text-slate-300">
        Weather from
        <select value={s.weather} onChange={(e) => updateScreensaver({ weather: e.target.value })} className={`${select} min-w-0 flex-1`}>
          <option value="">{weathers[0] ? `Automatic (${weathers[0].name})` : 'Automatic (none found)'}</option>
          {weathers.map((w) => (
            <option key={w.uid} value={w.uid}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
