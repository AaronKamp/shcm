import type { ProviderRegistry } from '../core/ProviderRegistry';
import type { CameraViewMode } from '../state/viewStore';

export interface VoiceConfig {
  /** Resolves the local Rust relay URL. No credential is ever held by the webview. */
  readonly resolveUrl: () => Promise<string>;
  readonly model: string;
  readonly voiceName?: string;
  /** Close the socket + release the mic after this much inactivity. Default 90s. */
  readonly idleTimeoutMs?: number;
  /** Mic RMS that counts as the user talking over playback (hands-free barge-in). Default 0.05. */
  readonly bargeInRms?: number;
}

export interface VoiceDeps {
  readonly getRegistry: () => Promise<ProviderRegistry>;
  /** Camera view state is per window (viewStore); injected so the voice layer stays UI-free. */
  readonly applyCameraView: (uid: string, mode: CameraViewMode) => void;
}
