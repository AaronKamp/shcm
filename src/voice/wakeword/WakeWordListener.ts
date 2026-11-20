import { MicCapture } from '../MicCapture';
import { FRAME_SAMPLES, WakeWordModel } from './WakeWordModel';

/** openWakeWord's recommended default. */
const THRESHOLD = 0.5;
/** One phrase scores high for several frames; ignore repeats this long. */
const COOLDOWN_MS = 2000;
/** If inference falls behind, keep at most ~1s of audio and drop the oldest. */
const MAX_BACKLOG = 16_000;

/**
 * Always-on, on-device wake-word detection: its own mic capture (16kHz, the
 * same worklet voice uses) feeding WakeWordModel. Audio never leaves the
 * webview; only `onWake` crosses out.
 */
export class WakeWordListener {
  private readonly mic = new MicCapture(({ pcm }) => this.push(new Int16Array(pcm)));
  private model: WakeWordModel | null = null;
  private backlog = new Int16Array(MAX_BACKLOG);
  private queued = 0;
  private busy = false;
  private stopped = false;
  private quietUntil = 0;
  private warned = false;

  constructor(private readonly onWake: (score: number) => void) {}

  async start(): Promise<void> {
    this.stopped = false;
    this.model ??= await WakeWordModel.load();
    if (this.stopped) return;
    await this.mic.start();
    // stop() may have run while the mic was opening.
    if (this.stopped) await this.mic.stop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.queued = 0;
    this.model?.reset();
    await this.mic.stop();
  }

  private push(samples: Int16Array): void {
    if (this.stopped) return;
    const overflow = this.queued + samples.length - MAX_BACKLOG;
    if (overflow > 0) {
      this.backlog.copyWithin(0, overflow, this.queued);
      this.queued -= overflow;
    }
    this.backlog.set(samples, this.queued);
    this.queued += samples.length;
    void this.drain();
  }

  private async drain(): Promise<void> {
    const model = this.model;
    if (this.busy || !model) return;
    this.busy = true;
    try {
      while (this.queued >= FRAME_SAMPLES && !this.stopped) {
        const frame = this.backlog.slice(0, FRAME_SAMPLES);
        this.backlog.copyWithin(0, FRAME_SAMPLES, this.queued);
        this.queued -= FRAME_SAMPLES;
        const score = await this.score(model, frame);
        if (score >= THRESHOLD && Date.now() >= this.quietUntil) {
          this.quietUntil = Date.now() + COOLDOWN_MS;
          model.reset();
          this.onWake(score);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private async score(model: WakeWordModel, frame: Int16Array): Promise<number> {
    try {
      return await model.score(frame);
    } catch (err: unknown) {
      if (!this.warned) console.warn('[wake] inference failed', err);
      this.warned = true;
      return 0;
    }
  }
}
