import { useCallback, useMemo, useState } from 'react';
import type { DeviceCommand, SmartEntity } from '../../core/types';
import { runCommand, useDeviceStore } from '../../state/deviceStore';
import { useMediaAppStore, type MediaApps } from '../../state/mediaAppStore';
import { activeApp, defaultLinks, hardwarePlayer, resolveApps } from './mediaApps';

/** The user's saved links for this speaker, else the automatic Music Assistant link. */
export const useEffectiveLinks = (speaker: SmartEntity): MediaApps | undefined => {
  const saved = useMediaAppStore((s) => s.links[speaker.uid]);
  // Select only the matched uid so unrelated entity updates don't re-render.
  const autoUid = useDeviceStore((s) => (saved ? undefined : defaultLinks(speaker, s.entities)?.musicAssistant?.playerUid));
  return useMemo(() => saved ?? (autoUid ? { musicAssistant: { playerUid: autoUid } } : undefined), [saved, autoUid]);
};

/** Where volume commands for `speaker` should go: its device's own player if MA fronts it, else itself. */
export const useVolumeEntity = (speaker: SmartEntity): SmartEntity => {
  const hardware = useDeviceStore((s) => hardwarePlayer(speaker, s.entities));
  return hardware ?? speaker;
};

/** A speaker's linked apps resolved against live entities, and which one is in charge. */
export const useSpeakerApps = (speaker: SmartEntity) => {
  const links = useEffectiveLinks(speaker);
  const spotify = useDeviceStore((s) => (links?.spotify ? s.entities.find((e) => e.uid === links.spotify?.playerUid) : undefined));
  const ma = useDeviceStore((s) => (links?.musicAssistant ? s.entities.find((e) => e.uid === links.musicAssistant?.playerUid) : undefined));
  const apps = useMemo(() => {
    const byUid = new Map<string, SmartEntity>();
    if (spotify) byUid.set(spotify.uid, spotify);
    if (ma) byUid.set(ma.uid, ma);
    return resolveApps(links, byUid);
  }, [links, spotify, ma]);
  const active = activeApp(apps);
  /** Where transport commands go: the app in charge, else the speaker. */
  const target = active?.player ?? speaker;
  return { links, apps, active, target };
};

/** Runs commands in order, stopping at the first failure; error clears after 4 s. */
export const useCommandRunner = () => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runAll = useCallback(async (commands: readonly DeviceCommand[]): Promise<boolean> => {
    setBusy(true);
    setError(null);
    let ok = true;
    for (const c of commands) {
      const res = await runCommand(c);
      if (!res.ok) {
        ok = false;
        setError(res.message ?? 'Command failed');
        setTimeout(() => setError(null), 4000);
        break;
      }
    }
    setBusy(false);
    return ok;
  }, []);
  return { busy, error, runAll };
};
