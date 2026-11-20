import { useEffect, useMemo, useState } from 'react';
import type { SmartEntity } from '../../core/types';
import { useDeviceStore } from '../../state/deviceStore';
import { useMediaAppStore, type MediaApps } from '../../state/mediaAppStore';
import { defaultLinks, looksMusicAssistant } from './mediaApps';

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Spotify's HA player is named after the integration; it lists Connect devices as sources. */
const looksSpotify = (e: SmartEntity): boolean => /spotify/i.test(e.nativeId) || /spotify/i.test(e.name);

/** Best guess at this speaker's Spotify Connect name: the source that matches its name. */
const guessDevice = (sources: readonly string[], speaker: SmartEntity): string => {
  const n = norm(speaker.name);
  return sources.find((s) => norm(s) === n) ?? sources.find((s) => norm(s).includes(n) || n.includes(norm(s))) ?? '';
};

/** Best guess at this speaker's Music Assistant player: a mass_* player with a matching name. */
const guessMa = (players: readonly SmartEntity[], speaker: SmartEntity): string => {
  const n = norm(speaker.name);
  const ma = players.filter(looksMusicAssistant);
  return (ma.find((p) => norm(p.name).includes(n) || n.includes(norm(p.name))) ?? (ma.length === 1 ? ma[0] : undefined))?.uid ?? '';
};

/** Modal to link a speaker card to its Spotify device and Music Assistant player. */
export function MediaAppsEditor({ speaker, onClose }: { speaker: SmartEntity; onClose: () => void }) {
  const entities = useDeviceStore((s) => s.entities);
  const current = useMediaAppStore((s) => s.links[speaker.uid]);
  const players = useMemo(() => entities.filter((e) => e.domain === 'media_player' && e.uid !== speaker.uid), [entities, speaker.uid]);
  const spotifyPlayers = useMemo(() => [...players].sort((a, b) => Number(looksSpotify(b)) - Number(looksSpotify(a))), [players]);
  // A Music Assistant player may be its own Music Assistant app.
  const maPlayers = useMemo(() => [...(looksMusicAssistant(speaker) ? [speaker] : []), ...players].sort((a, b) => Number(looksMusicAssistant(b)) - Number(looksMusicAssistant(a))), [players, speaker]);

  const firstSpotify = players.find(looksSpotify);
  const [spotifyUid, setSpotifyUid] = useState(current?.spotify?.playerUid ?? firstSpotify?.uid ?? '');
  const spotifyPlayer = players.find((p) => p.uid === spotifyUid);
  const sources = spotifyPlayer ? strings(spotifyPlayer.attributes['source_list']) : [];
  const [device, setDevice] = useState(current?.spotify?.device ?? (firstSpotify ? guessDevice(strings(firstSpotify.attributes['source_list']), speaker) : ''));
  const [maUid, setMaUid] = useState(current?.musicAssistant?.playerUid ?? defaultLinks(speaker, entities)?.musicAssistant?.playerUid ?? guessMa(players, speaker));

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = (): void => {
    const apps: { spotify?: MediaApps['spotify']; musicAssistant?: MediaApps['musicAssistant'] } = {};
    if (spotifyUid && device) apps.spotify = { playerUid: spotifyUid, device };
    if (maUid) apps.musicAssistant = { playerUid: maUid };
    useMediaAppStore.getState().setLinks(speaker.uid, apps);
    onClose();
  };

  const field = 'w-full rounded-md border border-line bg-panel-hi px-2 py-1.5 text-sm text-slate-100';
  const option = (p: SmartEntity) => (
    <option key={p.uid} value={p.uid}>
      {p.name} ({p.nativeId})
    </option>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div role="dialog" aria-modal aria-labelledby="media-apps-title" className="w-full max-w-md space-y-4 rounded-xl border border-line bg-panel p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 id="media-apps-title" className="text-sm font-semibold text-slate-100">Music apps for {speaker.name}</h2>
          <p className="mt-1 text-xs text-slate-400">Pick how each app reaches this speaker. Apps left unset don't appear on the card.</p>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold uppercase tracking-wider text-slate-400">Spotify</legend>
          <select aria-label="Spotify player" value={spotifyUid} onChange={(e) => { setSpotifyUid(e.target.value); setDevice(''); }} className={field}>
            <option value="">Not used</option>
            {spotifyPlayers.map(option)}
          </select>
          {spotifyUid && (
            <select aria-label="Spotify Connect device" value={device} onChange={(e) => setDevice(e.target.value)} className={field}>
              <option value="">{sources.length ? 'Choose this speaker’s Spotify device…' : 'No devices listed — open Spotify once so it sees them'}</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              {device && !sources.includes(device) && <option value={device}>{device} (not seen right now)</option>}
            </select>
          )}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold uppercase tracking-wider text-slate-400">Music Assistant</legend>
          <select aria-label="Music Assistant player" value={maUid} onChange={(e) => setMaUid(e.target.value)} className={field}>
            <option value="">Not used</option>
            {maPlayers.map(option)}
          </select>
        </fieldset>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-300 hover:bg-panel-hi">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={Boolean(spotifyUid) && !device} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
