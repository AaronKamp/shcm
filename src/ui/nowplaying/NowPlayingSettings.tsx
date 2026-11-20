import { X } from 'lucide-react';
import { useEffect } from 'react';
import { useNowPlayingStore } from '../../state/nowPlayingStore';
import { useCommandRunner } from '../media/mediaHooks';
import { looksMusicAssistant } from '../media/mediaApps';
import { DefaultImageField } from './DefaultImageField';
import { joinCommands, unjoinCommands, type GroupPlan } from './grouping';
import { useReceiver } from './ReceiverStrip';
import { useNowPlayingTarget } from './useNowPlaying';

const INTEGRATION_LABEL: Readonly<Record<string, string>> = {
  music_assistant: 'Music Assistant',
  cast: 'Google Cast',
  alexa_devices: 'Alexa',
  denonavr: 'Denon',
  samsungtv: 'Samsung TV',
  plex: 'Plex',
};

/** Settings for the Now Playing card: speakers (several = a group), the default picture, visibility. */
export function NowPlayingSettings({ onClose }: { onClose: () => void }) {
  const { candidates, chosen, auto, plan } = useNowPlayingTarget();
  const speakers = useNowPlayingStore((s) => s.speakers);
  const { setSpeakers, setVisible } = useNowPlayingStore.getState();
  const { busy, error, runAll } = useCommandRunner();

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (uid: string): void => {
    const base = auto ? [] : speakers;
    setSpeakers(base.includes(uid) ? base.filter((u) => u !== uid) : [...base, uid]);
  };
  const chosenUids = new Set(chosen.map((e) => e.uid));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal
        aria-label="Now Playing settings"
        className="flex max-h-[85vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-xl border border-line bg-panel p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-base font-semibold text-slate-100">Now Playing</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-slate-400 hover:bg-panel-hi hover:text-slate-100">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <section className="flex flex-col gap-2" aria-label="Speakers">
          <div className="flex items-baseline gap-2">
            <h3 className="flex-1 text-sm font-semibold text-slate-200">Speakers</h3>
            <button type="button" onClick={() => setSpeakers([])} disabled={auto} className="text-xs text-accent hover:underline disabled:text-slate-500 disabled:no-underline">
              Follow what's playing
            </button>
          </div>
          <p className="text-xs text-slate-400">Pick one, or several to play together. The first one you pick leads the group.</p>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {candidates.map((e) => {
              const on = !auto && chosenUids.has(e.uid);
              const lead = on && chosen[0]?.uid === e.uid && chosen.length > 1;
              const via = looksMusicAssistant(e) ? 'Music Assistant' : e.integration ? (INTEGRATION_LABEL[e.integration] ?? e.integration) : undefined;
              return (
                <li key={e.uid}>
                  <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 hover:bg-panel-hi">
                    <input type="checkbox" checked={on} onChange={() => toggle(e.uid)} className="accent-accent" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-100">
                        {e.name}
                        {lead && <span className="ml-1.5 rounded bg-accent/20 px-1 text-[10px] uppercase text-accent">leads</span>}
                      </span>
                      <span className="block truncate text-xs text-slate-500">{[via, e.area, e.available ? e.state : 'unavailable'].filter(Boolean).join(' · ')}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {plan && plan.kind !== 'single' && <GroupStatus plan={plan} busy={busy} onRun={(c) => void runAll(c)} />}
          {error && <p className="text-xs text-bad">{error}</p>}
        </section>

        <ReceiverField />

        <DefaultImageField />

        <button
          type="button"
          onClick={() => {
            setVisible(false);
            onClose();
          }}
          className="self-start text-xs text-slate-400 hover:text-slate-100 hover:underline"
        >
          Hide this card (show it again from Edit layout)
        </button>
      </div>
    </div>
  );
}

/** Which AV receiver the slim strip under the card controls, or none. */
function ReceiverField() {
  const setting = useNowPlayingStore((s) => s.receiver);
  const { receivers, receiver } = useReceiver();
  if (receivers.length === 0) return null;
  return (
    <label className="flex flex-col gap-1 text-sm font-semibold text-slate-200">
      Receiver strip
      <span className="text-xs font-normal text-slate-400">Input, sound mode and volume in a slim row under the card.</span>
      <select
        value={setting}
        onChange={(e) => useNowPlayingStore.getState().setReceiver(e.target.value)}
        className="rounded-md border border-line bg-panel-hi px-2 py-1.5 text-sm font-normal text-slate-200"
      >
        <option value="">Automatic{setting === '' && receiver ? ` (${receiver.name})` : ''}</option>
        {receivers.map((e) => (
          <option key={e.uid} value={e.uid}>
            {e.name}
          </option>
        ))}
        <option value="none">Don't show</option>
      </select>
    </label>
  );
}

function GroupStatus({ plan, busy, onRun }: { plan: Exclude<GroupPlan, { kind: 'single' }>; busy: boolean; onRun: (c: ReturnType<typeof joinCommands>) => void }) {
  const box = 'flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs';
  const button = 'shrink-0 rounded-md bg-accent px-2 py-1 font-medium text-white disabled:opacity-50';
  switch (plan.kind) {
    case 'group':
      return <p className={`${box} border-line text-slate-300`}>Playing through the group “{plan.player.name}”.</p>;
    case 'joined':
      return (
        <div className={`${box} border-line text-slate-300`}>
          <span className="flex-1">Grouped: {plan.player.name} leads.</span>
          <button type="button" disabled={busy} onClick={() => onRun(unjoinCommands(plan.others))} className="shrink-0 rounded-md border border-line px-2 py-1 text-slate-200 hover:bg-panel-hi disabled:opacity-50">
            Ungroup
          </button>
        </div>
      );
    case 'joinable':
      return (
        <div className={`${box} border-warn/40 text-slate-300`}>
          <span className="flex-1">These aren't grouped yet.</span>
          <button type="button" disabled={busy} onClick={() => onRun(joinCommands(plan.player, plan.others))} className={button}>
            Group speakers
          </button>
        </div>
      );
    case 'unsupported':
      return (
        <p className={`${box} border-warn/40 text-slate-300`}>
          {plan.player.name} can't lead a group from here. Make a speaker group in the Google Home app (for Chromecasts) or in Music Assistant; once it exists, choosing these same speakers plays through it automatically.
        </p>
      );
  }
}
