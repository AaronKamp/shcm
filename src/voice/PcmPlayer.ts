import { base64PcmToFloat32, resampleLinear } from './pcm';
import { OUTPUT_SAMPLE_RATE } from './protocol';
import { PLAYBACK_PROCESSOR, loadWorklets } from './worklets';

/** How long to wait for the audio engine to start before carrying on without it. */
const RESUME_WAIT_MS = 800;

export interface PcmPlayerEvents {
  readonly onPlayingChange: (playing: boolean) => void;
  readonly onLevel: (rms: number) => void;
  /** The browser is holding audio until the next tap/key press (autoplay policy). */
  readonly onBlocked: (blocked: boolean) => void;
}

/**
 * Streams 24kHz int16 PCM from Gemini into an AudioWorklet queue. `flush()`
 * empties the queue on the audio thread within one render quantum (~3ms),
 * which is what makes barge-in feel instant.
 */
export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private starting: Promise<void> | null = null;
  private isPlaying = false;

  constructor(private readonly events: PcmPlayerEvents) {}

  get playing(): boolean {
    return this.isPlaying;
  }

  /** Must be called from a user gesture at least once (autoplay policy). */
  start(): Promise<void> {
    if (this.node) return this.resume();
    this.starting ??= this.open().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  /** Decodes off the critical path and posts with transfer; never blocks on playback. */
  enqueueBase64(b64: string): void {
    const node = this.node;
    const ctx = this.ctx;
    if (!node || !ctx) return;
    const samples = resampleLinear(base64PcmToFloat32(b64), OUTPUT_SAMPLE_RATE, ctx.sampleRate);
    node.port.postMessage({ type: 'push', samples }, [samples.buffer]);
  }

  flush(): void {
    this.node?.port.postMessage({ type: 'flush' });
    this.setPlaying(false);
  }

  async stop(): Promise<void> {
    await this.starting?.catch(() => undefined);
    this.flush();
    this.node?.port.close();
    this.node?.disconnect();
    this.node = null;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && ctx.state !== 'closed') await ctx.close();
  }

  /**
   * A wake word is not a user gesture, so the browser may hold the context
   * suspended and leave `resume()` pending. Never block on that: give up after
   * a moment and retry on the next tap or key press instead.
   */
  private async resume(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'suspended') return;
    await Promise.race([ctx.resume().catch(() => undefined), new Promise((r) => setTimeout(r, RESUME_WAIT_MS))]);
    if ((ctx.state as AudioContextState) !== 'suspended') return;
    this.events.onBlocked(true);
    const retry = (): void => {
      window.removeEventListener('pointerdown', retry, true);
      window.removeEventListener('keydown', retry, true);
      if (this.ctx !== ctx) return;
      void ctx.resume().then(
        () => this.events.onBlocked(false),
        () => undefined,
      );
    };
    window.addEventListener('pointerdown', retry, true);
    window.addEventListener('keydown', retry, true);
  }

  private async open(): Promise<void> {
    let ctx: AudioContext;
    try {
      // Native 24kHz avoids resampling entirely where the engine allows it.
      ctx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE, latencyHint: 'interactive' });
    } catch {
      ctx = new AudioContext({ latencyHint: 'interactive' });
    }
    this.ctx = ctx;
    try {
      await loadWorklets(ctx);
      const node = new AudioWorkletNode(ctx, PLAYBACK_PROCESSOR, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      node.port.onmessage = (e: MessageEvent<unknown>) => {
        const d = e.data;
        if (typeof d !== 'object' || d === null || !('type' in d)) return;
        if (d.type === 'playing') this.setPlaying(true);
        else if (d.type === 'drained') this.setPlaying(false);
        else if (d.type === 'level' && 'rms' in d && typeof d.rms === 'number') this.events.onLevel(d.rms);
      };
      node.connect(ctx.destination);
      this.node = node;
      await this.resume();
    } catch (err: unknown) {
      this.ctx = null;
      await ctx.close().catch(() => undefined);
      throw err;
    }
  }

  private setPlaying(playing: boolean): void {
    if (playing === this.isPlaying) return;
    this.isPlaying = playing;
    this.events.onPlayingChange(playing);
  }
}
