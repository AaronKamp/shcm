/**
 * Audio levels for the waveform, kept outside React/Zustand: they update ~30x/sec
 * per direction and are read straight from a canvas rAF loop.
 */

export const LEVEL_HISTORY = 48;

class LevelMeter {
  private readonly ring = new Float32Array(LEVEL_HISTORY);
  private head = 0;
  private latest = 0;

  push(rms: number): void {
    // Perceptual-ish curve so quiet speech still moves the bars.
    const v = Math.min(1, Math.sqrt(Math.max(0, rms)) * 1.6);
    this.latest = v;
    this.ring[this.head] = v;
    this.head = (this.head + 1) % LEVEL_HISTORY;
  }

  /** Oldest → newest. Reuses `out` to avoid per-frame allocation. */
  read(out: Float32Array): Float32Array {
    for (let i = 0; i < LEVEL_HISTORY; i++) out[i] = this.ring[(this.head + i) % LEVEL_HISTORY] ?? 0;
    return out;
  }

  get current(): number {
    return this.latest;
  }

  decay(): void {
    this.push(this.latest * this.latest * 0.5);
  }

  reset(): void {
    this.ring.fill(0);
    this.latest = 0;
  }
}

export const micLevels = new LevelMeter();
export const speakerLevels = new LevelMeter();
