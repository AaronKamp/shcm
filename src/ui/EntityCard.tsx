import { Lightbulb } from 'lucide-react';
import { memo, useState } from 'react';
import type { DeviceCommand, SmartEntity } from '../core/types';
import { runCommand } from '../state/deviceStore';
import { isLightLike, useLayoutStore } from '../state/layoutStore';
import { DIMMER_ROW, DimmerSlider, isDimmable } from './DimmerSlider';
import { MediaAppBar, useHasMediaBar } from './media/MediaAppBar';
import { useVolumeEntity } from './media/mediaHooks';
import { ReceiverControls, hasReceiverControls } from './ReceiverControls';
import { describeState, domainIcon, isActive, primaryAction, stepActions } from './entityActions';

interface Props {
  readonly entity: SmartEntity;
  readonly compact?: boolean;
}

/** One device card. Memoized: re-renders only when this entity object changes. */
export const EntityCard = memo(function EntityCard({ entity, compact = false }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Switches the user marked as lights get the light icon.
  const asLight = useLayoutStore((s) => entity.domain === 'switch' && isLightLike(entity, s));
  const Icon = asLight ? Lightbulb : domainIcon(entity.domain);
  const primary = primaryAction(entity);
  const steps = stepActions(entity);
  const active = isActive(entity);
  const dimmable = isDimmable(entity);
  const mediaBar = useHasMediaBar(entity);
  // A Music Assistant player's volume goes to the device itself (e.g. the Denon), not MA's software volume.
  const volumeEntity = useVolumeEntity(entity);

  const run = async (command: DeviceCommand): Promise<void> => {
    setBusy(true);
    setError(null);
    const res = await runCommand(command);
    setBusy(false);
    if (!res.ok) {
      setError(res.message ?? 'Command failed');
      setTimeout(() => setError(null), 4000);
    }
  };

  const lightLike = entity.domain === 'light' || asLight;
  const tone = !entity.available
    ? 'border-line opacity-60'
    : active
      ? lightLike
        ? 'border-lit-line bg-lit-fill'
        : 'border-accent/60 bg-accent/10'
      : 'border-line bg-panel hover:bg-panel-hi';

  // Lit lights: an orange bulb on a soft orange glow; other active devices: solid accent.
  const iconTone = !active ? 'bg-panel-hi text-slate-300' : lightLike ? 'bg-accent/20 text-accent' : 'bg-accent text-white';

  const body = (
    <>
      <span className={`flex shrink-0 items-center justify-center rounded-lg ${compact ? 'h-8 w-8' : 'h-10 w-10'} ${iconTone}`}>
        <Icon className={compact ? 'h-4 w-4' : 'h-5 w-5'} aria-hidden />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium text-slate-100">{entity.name}</span>
        <span className={`block truncate text-xs ${error ? 'text-bad' : 'text-slate-400'}`}>{error ?? describeState(entity)}</span>
      </span>
    </>
  );

  return (
    <div
      className={`flex flex-col gap-2 rounded-xl border transition-colors ${compact ? 'p-2' : 'p-3'} ${tone} ${busy ? 'animate-pulse' : ''}`}
      data-tile
      data-testid={`entity-${entity.nativeId}`}
      data-state={entity.state}
    >
      <div className="flex items-center gap-3">
        {primary ? (
          <button
            type="button"
            disabled={busy || !entity.available}
            onClick={() => void run(primary.command)}
            className="flex min-w-0 flex-1 items-center gap-3 disabled:cursor-not-allowed"
            title={primary.label}
            aria-label={`${entity.name}: ${primary.label}`}
          >
            {body}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3">{body}</div>
        )}
        {steps.length > 0 && (
          <div className="flex shrink-0 gap-1">
            {steps.map((s) => (
              <button
                key={s.label}
                type="button"
                disabled={busy || !entity.available}
                onClick={() => void run(s.command)}
                aria-label={`${entity.name}: ${s.label === '+' ? 'raise' : 'lower'} setpoint`}
                className="h-8 w-8 rounded-lg bg-panel-hi text-lg leading-none text-slate-200 hover:bg-line disabled:opacity-50"
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {dimmable ? (
        <DimmerSlider entity={entity} disabled={!entity.available} onCommand={run} />
      ) : (
        // On/off-only lights keep the same height as dimmable ones.
        lightLike && !compact && <div className={DIMMER_ROW} aria-hidden />
      )}
      {mediaBar && <MediaAppBar speaker={entity} />}
      {hasReceiverControls(entity) && <ReceiverControls entity={volumeEntity} disabled={!volumeEntity.available} onCommand={run} />}
    </div>
  );
});
