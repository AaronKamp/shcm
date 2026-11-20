import { useMemo } from 'react';
import type { SmartEntity } from '../../core/types';
import { useDeviceStore } from '../../state/deviceStore';
import { withName, useLayoutStore } from '../../state/layoutStore';
import { useNowPlayingStore } from '../../state/nowPlayingStore';
import { autoSpeaker, planGroup, speakerCandidates, type GroupPlan } from './grouping';

export interface NowPlayingTarget {
  readonly candidates: readonly SmartEntity[];
  /** The speakers chosen (or the one picked automatically). */
  readonly chosen: readonly SmartEntity[];
  readonly auto: boolean;
  readonly plan: GroupPlan | undefined;
}

/** Resolves the card's chosen speakers against live entities, with the user's renames. */
export const useNowPlayingTarget = (): NowPlayingTarget => {
  const entities = useDeviceStore((s) => s.entities);
  const names = useLayoutStore((s) => s.names);
  const speakers = useNowPlayingStore((s) => s.speakers);
  return useMemo(() => {
    const all = entities.map((e) => withName(e, names));
    const candidates = speakerCandidates(all);
    const byUid = new Map(all.map((e) => [e.uid, e]));
    const picked = speakers.flatMap((uid) => byUid.get(uid) ?? []);
    const fallback = picked.length === 0 ? autoSpeaker(candidates) : undefined;
    const chosen = fallback ? [fallback] : picked;
    return { candidates, chosen, auto: fallback !== undefined, plan: planGroup(chosen, all) };
  }, [entities, names, speakers]);
};

/** "Loft TV + Denon", for the card's header. */
export const speakerLabel = (chosen: readonly SmartEntity[]): string =>
  chosen.length <= 2 ? chosen.map((e) => e.name).join(' + ') : `${chosen[0]?.name ?? ''} + ${chosen.length - 1} more`;
