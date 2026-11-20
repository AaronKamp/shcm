import type { SmartEntity } from '../../core/types';
import type { LinkedApp } from './mediaApps';

interface Props {
  readonly speaker: SmartEntity;
  readonly apps: readonly LinkedApp[];
  /** Highlighted app. */
  readonly selected: LinkedApp | undefined;
  readonly disabled: boolean;
  readonly onPick: (app: LinkedApp) => void;
  /** Tooltip / label text for a non-selected app. */
  readonly verb?: string;
}

/** Segmented Spotify | Music Assistant buttons. */
export function AppSwitch({ speaker, apps, selected, disabled, onPick, verb = 'Play' }: Props) {
  return (
    <div role="group" aria-label={`${speaker.name} music app`} className="flex rounded-md border border-line p-0.5 text-xs">
      {apps.map((a) => (
        <button
          key={a.kind}
          type="button"
          disabled={disabled || !a.player.available}
          onClick={() => onPick(a)}
          aria-pressed={a === selected}
          title={a === selected ? `${a.label} is selected` : `${verb} ${a.label} on ${speaker.name}`}
          className={`min-w-0 flex-1 truncate rounded px-2 py-0.5 ${a === selected ? 'bg-accent text-white' : 'text-slate-300 hover:bg-panel-hi'} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
