import { INPUT_SAMPLE_RATE } from './protocol';
import { CAPTURE_PROCESSOR, loadWorklets } from './worklets';

export interface MicChunk {
  /** 16kHz int16 LE mono. */
  readonly pcm: ArrayBuffer;
  readonly rms: number;
}

/** 512 samples @ 16kHz = 32ms per chunk: low latency without flooding the socket. */
const CHUNK_SAMPLES = 512;

/**
 * Microphone → 16kHz 16-bit mono PCM chunks via an AudioWorklet. Capture runs
 * at the device's native rate and is decimated on the audio thread, which
 * works on WebView2, WKWebView and Android WebView alike.
 */
export class MicCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private starting: Promise<void> | null = null;

  constructor(private readonly onChunk: (chunk: MicChunk) => void) {}

  get active(): boolean {
    return this.node !== null;
  }

  start(): Promise<void> {
    if (this.node) return Promise.resolve();
    this.starting ??= this.open().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  async stop(): Promise<void> {
    await this.starting?.catch(() => undefined);
    this.node?.port.close();
    this.node?.disconnect();
    this.node = null;
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && ctx.state !== 'closed') await ctx.close();
  }

  private async open(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    try {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.ctx = ctx;
      await loadWorklets(ctx);
      const node = new AudioWorkletNode(ctx, CAPTURE_PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: 'explicit',
        processorOptions: { targetRate: INPUT_SAMPLE_RATE, chunkSamples: CHUNK_SAMPLES },
      });
      node.port.onmessage = (e: MessageEvent<unknown>) => {
        const d = e.data;
        if (typeof d === 'object' && d !== null && 'pcm' in d && 'rms' in d) {
          const { pcm, rms } = d;
          if (pcm instanceof ArrayBuffer && typeof rms === 'number') this.onChunk({ pcm, rms });
        }
      };
      // A muted sink keeps the graph pulling on engines that skip output-less nodes.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      ctx.createMediaStreamSource(stream).connect(node).connect(sink).connect(ctx.destination);
      if (ctx.state === 'suspended') await ctx.resume();
      this.stream = stream;
      this.node = node;
    } catch (err: unknown) {
      for (const t of stream.getTracks()) t.stop();
      await this.ctx?.close().catch(() => undefined);
      this.ctx = null;
      throw err;
    }
  }
}
