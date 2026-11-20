import { getGeminiProxyUrl } from '../platform/secrets';
import { inTauri } from '../platform/window';
import { useViewStore } from '../state/viewStore';
import { VoiceSession, type VoiceConfig } from '../voice/VoiceSession';
import { startRegistry } from './bootstrap';

/**
 * Voice runs only inside the Tauri shell: the Gemini API key lives in the OS
 * credential store and is attached upstream by the Rust relay, so nothing
 * secret is ever compiled into (or held by) the frontend.
 *
 * Non-secret tuning via Vite env:
 *   VITE_GEMINI_LIVE_MODEL – model override
 *   VITE_GEMINI_VOICE      – prebuilt voice (Puck, Kore, Charon, …)
 */
export const DEFAULT_LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-09-2025';

const env = (name: string): string | undefined => {
  const v: unknown = import.meta.env[name];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};

const voiceConfig = (): VoiceConfig => {
  const voiceName = env('VITE_GEMINI_VOICE');
  return {
    resolveUrl: getGeminiProxyUrl,
    model: env('VITE_GEMINI_LIVE_MODEL') ?? DEFAULT_LIVE_MODEL,
    ...(voiceName ? { voiceName } : {}),
  };
};

let session: VoiceSession | null | undefined;

/** One voice session per window; `null` outside the desktop app (no relay to talk to). */
export const getVoiceSession = (): VoiceSession | null => {
  if (session !== undefined) return session;
  session = inTauri()
    ? new VoiceSession(voiceConfig(), {
        getRegistry: startRegistry,
        applyCameraView: (uid, mode) => useViewStore.getState().applyCameraView(uid, mode),
      })
    : null;
  return session;
};
