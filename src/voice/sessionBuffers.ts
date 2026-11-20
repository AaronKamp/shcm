import { setVoice } from '../state/voiceStore';

const TRANSCRIPT_THROTTLE_MS = 120;

/**
 * Accumulates streaming transcription fragments and publishes them to the store
 * at most every 120ms (rule 2: no per-fragment UI updates).
 */
export class TranscriptBuffer {
  private user = '';
  private model = '';
  private fresh = true;
  private timer: ReturnType<typeof setTimeout> | null = null;

  reset(): void {
    this.user = this.model = '';
    this.fresh = true;
    setVoice({ userText: '', modelText: '' });
  }

  /** The next user fragment starts a new exchange (clears the previous one). */
  turnComplete(): void {
    this.fresh = true;
  }

  addUser(text: string): void {
    if (this.fresh) this.user = this.model = '';
    this.fresh = false;
    this.user += text;
    this.queue();
  }

  addModel(text: string): void {
    this.model += text;
    this.queue();
  }

  private queue(): void {
    this.timer ??= setTimeout(() => {
      this.timer = null;
      setVoice({ userText: this.user, modelText: this.model });
    }, TRANSCRIPT_THROTTLE_MS);
  }
}

/**
 * Mic chunks held back from the socket: a short pre-roll ring while the mic is
 * gated (so a PTT press keeps its first syllable), or everything said while the
 * socket is still connecting, up to `max`.
 */
export class ChunkBuffer {
  private chunks: ArrayBuffer[] = [];

  ring(chunk: ArrayBuffer, size: number): void {
    this.chunks.push(chunk);
    if (this.chunks.length > size) this.chunks.shift();
  }

  append(chunk: ArrayBuffer, max: number): void {
    if (this.chunks.length < max) this.chunks.push(chunk);
  }

  drain(): ArrayBuffer[] {
    const out = this.chunks;
    this.chunks = [];
    return out;
  }
}
