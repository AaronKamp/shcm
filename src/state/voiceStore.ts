import { create } from 'zustand';

/**
 * - `off`: no session.  `connecting`: socket/mic/setup in flight.
 * - `ready`: session open, mic gated.  `listening`: mic streaming to Gemini.
 * - `thinking`: tool calls running.  `speaking`: model audio playing.
 */
export type VoiceStatus = 'off' | 'connecting' | 'ready' | 'listening' | 'thinking' | 'speaking' | 'error';

/** `ptt`: mic open only while the hotkey is held. `handsfree`: wake button, server VAD ends turns. */
export type MicMode = 'ptt' | 'handsfree';

interface VoiceState {
  readonly status: VoiceStatus;
  readonly micMode: MicMode | null;
  /** Floating waveform pill shown. */
  readonly visible: boolean;
  readonly userText: string;
  readonly modelText: string;
  /** Last tool outcome, e.g. "Kitchen Lights → turn_off ✓". */
  readonly lastAction: string | null;
  readonly error: string | null;
  /** No Gemini key in the OS credential store (checked via `has_secret`, or relay close 4001). */
  readonly needsKey: boolean;
}

export const useVoiceStore = create<VoiceState>()(() => ({
  status: 'off',
  micMode: null,
  visible: false,
  userText: '',
  modelText: '',
  lastAction: null,
  error: null,
  needsKey: false,
}));

export const setVoice = (patch: Partial<VoiceState>): void => useVoiceStore.setState(patch);
