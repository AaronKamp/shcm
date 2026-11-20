/**
 * AudioWorklet processors, kept as source strings so they load from a Blob URL
 * (no bundler asset wiring, and DOM lib lacks AudioWorkletGlobalScope types).
 * Both run on the audio rendering thread, so the UI thread never blocks audio.
 */

/**
 * Mic → 16kHz int16. Box-filter decimation from the context rate (48k/44.1k)
 * doubles as a cheap anti-alias filter for speech. Posts fixed-size chunks
 * (transferred, zero-copy) with their RMS for the waveform and local VAD.
 */
const CAPTURE_SRC = `
class ShcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.ratio = sampleRate / o.targetRate;
    this.chunk = o.chunkSamples;
    this.buf = new Int16Array(this.chunk);
    this.n = 0; this.acc = 0; this.cnt = 0; this.pos = 0; this.sq = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i]; this.cnt++; this.pos += 1;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        let s = this.acc / this.cnt;
        this.acc = 0; this.cnt = 0;
        s = s < -1 ? -1 : s > 1 ? 1 : s;
        this.sq += s * s;
        this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.n === this.chunk) {
          const out = this.buf.buffer;
          this.port.postMessage({ pcm: out, rms: Math.sqrt(this.sq / this.chunk) }, [out]);
          this.buf = new Int16Array(this.chunk); this.n = 0; this.sq = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('shcm-capture', ShcmCapture);
`;

/**
 * Jitter-free playback queue. 'flush' drops everything instantly (barge-in).
 * Reports 'playing' / 'drained' transitions and output level ~30x/sec.
 */
const PLAYBACK_SRC = `
class ShcmPlayback extends AudioWorkletProcessor {
  constructor() {
    super();
    this.q = []; this.head = null; this.idx = 0; this.playing = false;
    this.sq = 0; this.cnt = 0; this.levelEvery = Math.round(sampleRate / 30);
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'push') this.q.push(m.samples);
      else if (m.type === 'flush') { this.q.length = 0; this.head = null; this.idx = 0; this.setPlaying(false); }
    };
  }
  setPlaying(p) {
    if (p === this.playing) return;
    this.playing = p;
    this.port.postMessage({ type: p ? 'playing' : 'drained' });
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    let w = 0;
    while (w < out.length) {
      if (!this.head) { this.head = this.q.shift() || null; this.idx = 0; if (!this.head) break; }
      const take = Math.min(out.length - w, this.head.length - this.idx);
      out.set(this.head.subarray(this.idx, this.idx + take), w);
      w += take; this.idx += take;
      if (this.idx >= this.head.length) this.head = null;
    }
    out.fill(0, w);
    for (let i = 1; i < outputs[0].length; i++) outputs[0][i].set(out);
    if (w > 0) this.setPlaying(true);
    else if (!this.head && this.q.length === 0) this.setPlaying(false);
    for (let i = 0; i < w; i++) this.sq += out[i] * out[i];
    this.cnt += out.length;
    if (this.cnt >= this.levelEvery) {
      this.port.postMessage({ type: 'level', rms: Math.sqrt(this.sq / this.cnt) });
      this.sq = 0; this.cnt = 0;
    }
    return true;
  }
}
registerProcessor('shcm-playback', ShcmPlayback);
`;

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

/** Registers both processors on a context once. */
export const loadWorklets = (ctx: BaseAudioContext): Promise<void> => {
  const existing = loaded.get(ctx);
  if (existing) return existing;
  const url = URL.createObjectURL(new Blob([CAPTURE_SRC, PLAYBACK_SRC], { type: 'application/javascript' }));
  const p = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
  loaded.set(ctx, p);
  return p;
};

export const CAPTURE_PROCESSOR = 'shcm-capture';
export const PLAYBACK_PROCESSOR = 'shcm-playback';
