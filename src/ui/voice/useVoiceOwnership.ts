import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect } from 'react';
import { inTauri } from '../../platform/window';
import { useVoiceStore } from '../../state/voiceStore';
import type { VoiceSession } from '../../voice/VoiceSession';

/** A window opened its mic; every other window ends its voice session. */
const VOICE_CLAIM_EVENT = 'shcm://voice-claim';
/** A wake-word session with nothing said or heard for this long ends itself. */
const WAKE_IDLE_MS = 20_000;

interface ClaimPayload {
  readonly label: string;
}

/**
 * One voice session per app: the dashboard and the overlay each own a
 * VoiceSession, and a hands-free one keeps listening after its window hides,
 * so whichever window opens its mic tells the other to shut down. Otherwise
 * both hear the user and both answer.
 */
export function useSingleVoiceSession(session: VoiceSession | null): void {
  const micMode = useVoiceStore((s) => s.micMode);

  useEffect(() => {
    if (!session || !inTauri()) return;
    const label = getCurrentWindow().label;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void listen<ClaimPayload>(VOICE_CLAIM_EVENT, (e) => {
      if (e.payload.label !== label && useVoiceStore.getState().status !== 'off') void session.shutdown(true);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [session]);

  useEffect(() => {
    if (!micMode || !inTauri()) return;
    void emit<ClaimPayload>(VOICE_CLAIM_EVENT, { label: getCurrentWindow().label });
  }, [micMode]);
}

let wakeStarted = false;
/** The current hands-free session was opened by the wake word (so it may end itself). */
export const markWakeSession = (): void => {
  wakeStarted = true;
};

/**
 * A session opened by "Hey Jarvis" ends after WAKE_IDLE_MS of quiet, like a
 * smart speaker, instead of streaming the room to Gemini until someone clicks
 * stop. Sessions started from the mic button keep running as before.
 */
export function useWakeAutoEnd(session: VoiceSession | null): void {
  useEffect(() => {
    if (!session) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clear = (): void => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const arm = (): void => {
      clear();
      timer = setTimeout(() => {
        const s = useVoiceStore.getState();
        if (!wakeStarted || s.micMode !== 'handsfree') return;
        // Still answering or running a tool: give it another window.
        if (s.status === 'speaking' || s.status === 'thinking' || s.status === 'connecting') return arm();
        void session.shutdown(true);
      }, WAKE_IDLE_MS);
    };
    const unsubscribe = useVoiceStore.subscribe((s, prev) => {
      if (s.micMode !== 'handsfree') {
        wakeStarted = false;
        return clear();
      }
      if (!wakeStarted) return;
      if (!timer || s.userText !== prev.userText || s.modelText !== prev.modelText || s.status !== prev.status || s.lastAction !== prev.lastAction) arm();
    });
    return () => {
      unsubscribe();
      clear();
    };
  }, [session]);
}
