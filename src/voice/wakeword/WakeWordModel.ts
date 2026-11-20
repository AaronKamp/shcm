import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

/** 80ms at 16kHz: the step openWakeWord models are built around. */
export const FRAME_SAMPLES = 1280;
/** Three 160-sample hops of history, so mel frames line up across steps (as openWakeWord streams). */
const CONTEXT_SAMPLES = 480;
const MEL_BINS = 32;
/** Mel frames per embedding (~775ms). */
const EMBED_WINDOW = 76;
const EMBED_DIM = 96;
/** Embeddings the wake-word classifier looks at (~1.3s). */
const FEATURE_WINDOW = 16;

/** Served from public/wakeword (openWakeWord v0.5.1 release models). */
const MODEL_BASE = '/wakeword/';
export const DEFAULT_WAKE_MODEL = 'hey_jarvis_v0.1';

// The bundled loader only needs the .wasm; threads need cross-origin isolation, which the webview doesn't have.
ort.env.wasm.wasmPaths = { wasm: wasmUrl };
ort.env.wasm.numThreads = 1;

const run = async (session: ort.InferenceSession, data: Float32Array, dims: readonly number[]): Promise<Float32Array> => {
  const input = session.inputNames[0];
  const output = session.outputNames[0];
  if (!input || !output) throw new Error('Wake-word model has no input or output');
  const result = await session.run({ [input]: new ort.Tensor('float32', data, dims) });
  const out = result[output]?.data;
  if (!(out instanceof Float32Array)) throw new Error('Wake-word model returned an unexpected tensor');
  return out;
};

const onesRow = (): Float32Array => new Float32Array(MEL_BINS).fill(1);

/**
 * openWakeWord in the webview: raw audio → mel spectrogram → speech embeddings
 * → wake-word score. All three ONNX models run locally on the CPU (WASM); no
 * audio leaves the machine.
 */
export class WakeWordModel {
  private mel: Float32Array[] = [];
  private features: Float32Array[] = [];
  private tail = new Float32Array(CONTEXT_SAMPLES);

  private constructor(
    private readonly melModel: ort.InferenceSession,
    private readonly embedModel: ort.InferenceSession,
    private readonly wordModel: ort.InferenceSession,
  ) {
    this.reset();
  }

  static async load(word = DEFAULT_WAKE_MODEL): Promise<WakeWordModel> {
    const options: ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'] };
    const [mel, embed, wordModel] = await Promise.all(
      ['melspectrogram', 'embedding_model', word].map((name) => ort.InferenceSession.create(`${MODEL_BASE}${name}.onnx`, options)),
    );
    if (!mel || !embed || !wordModel) throw new Error('Wake-word models failed to load');
    return new WakeWordModel(mel, embed, wordModel);
  }

  /** Clears history, e.g. after a detection so the same utterance doesn't fire twice. */
  reset(): void {
    this.mel = Array.from({ length: EMBED_WINDOW }, onesRow);
    this.features = [];
    this.tail = new Float32Array(CONTEXT_SAMPLES);
  }

  /** One 80ms int16 frame → wake score 0–1. Stays 0 for the first ~1.3s of audio. */
  async score(frame: Int16Array): Promise<number> {
    // The models take int16 sample values as floats (not normalized to ±1).
    const audio = new Float32Array(CONTEXT_SAMPLES + FRAME_SAMPLES);
    audio.set(this.tail);
    for (let i = 0; i < FRAME_SAMPLES; i++) audio[CONTEXT_SAMPLES + i] = frame[i] ?? 0;
    this.tail = audio.slice(-CONTEXT_SAMPLES);

    const spec = await run(this.melModel, audio, [1, audio.length]);
    for (let i = 0; i + MEL_BINS <= spec.length; i += MEL_BINS) this.mel.push(spec.slice(i, i + MEL_BINS).map((v) => v / 10 + 2));
    this.mel.splice(0, Math.max(0, this.mel.length - EMBED_WINDOW));

    const window = new Float32Array(EMBED_WINDOW * MEL_BINS);
    this.mel.forEach((row, i) => window.set(row, i * MEL_BINS));
    const embedding = await run(this.embedModel, window, [1, EMBED_WINDOW, MEL_BINS, 1]);
    this.features.push(embedding.slice(0, EMBED_DIM));
    this.features.splice(0, Math.max(0, this.features.length - FEATURE_WINDOW));
    if (this.features.length < FEATURE_WINDOW) return 0;

    const feats = new Float32Array(FEATURE_WINDOW * EMBED_DIM);
    this.features.forEach((f, i) => feats.set(f, i * EMBED_DIM));
    const out = await run(this.wordModel, feats, [1, FEATURE_WINDOW, EMBED_DIM]);
    return out[0] ?? 0;
  }
}
