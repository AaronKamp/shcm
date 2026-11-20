import { Lightbulb, LightbulbOff } from 'lucide-react';
import { useState } from 'react';
import type { SmartEntity } from '../../core/types';
import { runCommand } from '../../state/deviceStore';
import { cmd } from '../entityActions';

type Action = 'turn_on' | 'turn_off';

/**
 * "All on / All off" for the lights in a section, beside its heading. Each light
 * gets its own command through the registry, so mixed providers work and one
 * failure doesn't stop the rest.
 */
export function MasterLights({ lights }: { lights: readonly SmartEntity[] }) {
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const usable = lights.filter((l) => l.available);
  const onCount = usable.filter((l) => l.state === 'on').length;

  const run = async (action: Action): Promise<void> => {
    const want = action === 'turn_on' ? 'on' : 'off';
    const targets = usable.filter((l) => l.state !== want);
    if (targets.length === 0) return;
    setBusy(action);
    setError(null);
    const results = await Promise.all(targets.map((l) => runCommand(cmd(l, action))));
    setBusy(null);
    const failed = results.filter((r) => !r.ok).length;
    if (failed) {
      setError(`${failed} of ${targets.length} didn’t respond`);
      setTimeout(() => setError(null), 4000);
    }
  };

  const btn =
    'flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-xs text-slate-200 hover:bg-panel-hi disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="All lights">
      <span className={`text-xs ${error ? 'text-bad' : 'text-slate-500'}`} role="status">
        {error ?? `${onCount}/${usable.length} on`}
      </span>
      <button type="button" className={`${btn} ${busy === 'turn_on' ? 'animate-pulse' : ''}`} disabled={busy !== null || onCount === usable.length} onClick={() => void run('turn_on')}>
        <Lightbulb className="h-3.5 w-3.5" aria-hidden /> All on
      </button>
      <button type="button" className={`${btn} ${busy === 'turn_off' ? 'animate-pulse' : ''}`} disabled={busy !== null || onCount === 0} onClick={() => void run('turn_off')}>
        <LightbulbOff className="h-3.5 w-3.5" aria-hidden /> All off
      </button>
    </div>
  );
}
