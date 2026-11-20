import { errorMessage } from '../core/DeviceProvider';
import { useLayoutStore } from '../state/layoutStore';
import { setVoice, useVoiceStore, type MicMode, type VoiceStatus } from '../state/voiceStore';
import { GeminiLiveClient, PROXY_CLOSE } from './GeminiLiveClient';
import { micLevels, speakerLevels } from './levels';
import { MicCapture, type MicChunk } from './MicCapture';
import { bytesToBase64 } from './pcm';
import { PcmPlayer } from './PcmPlayer';
import type { FunctionCall, ServerMessage } from './protocol';
import { ChunkBuffer, TranscriptBuffer } from './sessionBuffers';
import { buildSystemInstruction } from './systemInstruction';
import { executeToolCall, summarizeResponse } from './toolDispatcher';
import type { VoiceConfig, VoiceDeps } from './types';

export type { VoiceConfig, VoiceDeps } from './types';

/** ~320ms of audio kept while the mic is gated, so the first syllable after a PTT press survives. */
const PREROLL_CHUNKS = 10;
/** Cap for audio buffered while the socket is still connecting (~15s). */
const CONNECT_BUFFER_CHUNKS = 470;
/** Consecutive loud chunks (32ms each) needed to trigger local barge-in. */
const BARGE_IN_FRAMES = 3;

/**
 * Orchestrates one Gemini Live conversation: mic → socket → speaker, tool calls
 * → ProviderRegistry / camera view, and barge-in. UI talks to it only through
 * `beginTalk` / `endTalk` / `toggleHandsFree` and reads `useVoiceStore`.
 */
export class VoiceSession {
  private client: GeminiLiveClient | null = null;
  private connecting: Promise<void> | null = null;
  private readonly mic = new MicCapture((c) => this.onMic(c));
  private readonly player = new PcmPlayer({
    onPlayingChange: () => this.refresh(),
    onLevel: (rms) => speakerLevels.push(rms),
  });
  private micOpen = false;
  private endAfterFlush = false;
  private readonly buffered = new ChunkBuffer();
  private readonly transcript = new TranscriptBuffer();
  /** Set by local barge-in: drop in-flight audio of the interrupted turn until the server catches up. */
  private discardAudio = false;
  private loudFrames = 0;
  private pendingTools = 0;
  private readonly cancelled = new Set<string>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly config: VoiceConfig,
    private readonly deps: VoiceDeps,
  ) {}

  /** PTT press or wake click. Must run inside the user gesture (autoplay + mic prompts). */
  async beginTalk(mode: MicMode): Promise<void> {
    if (this.micOpen && useVoiceStore.getState().micMode === mode) return;
    this.bargeIn();
    this.micOpen = true;
    this.endAfterFlush = false;
    this.transcript.reset();
    setVoice({ visible: true, micMode: mode, error: null });
    this.touch();
    this.refresh();
    try {
      await Promise.all([this.player.start(), this.mic.start(), this.ensureConnected()]);
      this.flushBuffered();
    } catch (err: unknown) {
      this.fail(errorMessage(err));
    }
    this.refresh();
  }

  /** PTT release. Hands-free mode ignores it. */
  endTalk(): void {
    if (!this.micOpen || useVoiceStore.getState().micMode !== 'ptt') return;
    this.closeMic();
  }

  async toggleHandsFree(): Promise<void> {
    if (this.micOpen && useVoiceStore.getState().micMode === 'handsfree') this.closeMic();
    else await this.beginTalk('handsfree');
  }

  /** Stops talking, cuts playback, closes the socket and releases the mic. */
  async shutdown(hide = true): Promise<void> {
    this.micOpen = this.endAfterFlush = false;
    this.buffered.drain();
    this.clearIdle();
    this.player.flush();
    this.client?.close('client closed');
    this.client = null;
    await Promise.allSettled([this.mic.stop(), this.player.stop()]);
    micLevels.reset();
    speakerLevels.reset();
    setVoice(hide ? { visible: false, micMode: null } : { micMode: null });
    this.refresh();
  }

  private closeMic(): void {
    this.micOpen = false;
    // Released before the socket opened: keep what was said, send it + stream end on connect.
    if (this.client?.state === 'open') this.client.endAudioStream();
    else this.endAfterFlush = this.connecting !== null;
    if (!this.endAfterFlush) this.buffered.drain();
    setVoice({ micMode: null });
    this.touch();
    this.refresh();
  }

  private ensureConnected(): Promise<void> {
    if (this.client?.state === 'open') return Promise.resolve();
    this.connecting ??= (async () => {
      const [registry, url] = await Promise.all([this.deps.getRegistry(), this.config.resolveUrl()]);
      const client = new GeminiLiveClient(
        { ...this.config, url, systemInstruction: buildSystemInstruction(registry.snapshot(), useLayoutStore.getState().names) },
        { onMessage: (m) => this.onServer(m), onClose: (r, code) => this.onClose(client, r, code) },
      );
      this.client = client;
      await client.connect();
    })().finally(() => {
      this.connecting = null;
      this.refresh();
    });
    this.refresh();
    return this.connecting;
  }

  private onMic({ pcm, rms }: MicChunk): void {
    micLevels.push(this.micOpen ? rms : 0);
    if (!this.micOpen) return this.endAfterFlush ? undefined : this.buffered.ring(pcm, PREROLL_CHUNKS);
    // Hands-free barge-in: user talks over the assistant → cut it off locally right away.
    if (this.player.playing) {
      this.loudFrames = rms > (this.config.bargeInRms ?? 0.05) ? this.loudFrames + 1 : 0;
      if (this.loudFrames >= BARGE_IN_FRAMES) this.bargeIn();
    }
    if (this.client?.state === 'open') {
      this.client.sendAudio(bytesToBase64(pcm));
      this.touch();
    } else {
      this.buffered.append(pcm, CONNECT_BUFFER_CHUNKS);
    }
  }

  private flushBuffered(): void {
    const client = this.client;
    if (!(this.micOpen || this.endAfterFlush) || client?.state !== 'open') return;
    for (const pcm of this.buffered.drain()) client.sendAudio(bytesToBase64(pcm));
    if (this.endAfterFlush) client.endAudioStream();
    this.endAfterFlush = false;
  }

  private bargeIn(): void {
    this.loudFrames = 0;
    if (!this.player.playing) return;
    this.player.flush();
    this.discardAudio = true;
    speakerLevels.reset();
  }

  private onServer(msg: ServerMessage): void {
    switch (msg.kind) {
      case 'audio':
        if (!this.discardAudio) this.player.enqueueBase64(msg.base64);
        this.touch();
        break;
      case 'interrupted':
        this.player.flush();
        this.discardAudio = false;
        break;
      case 'turn_complete':
        this.discardAudio = false;
        this.transcript.turnComplete();
        break;
      case 'input_transcript':
        this.transcript.addUser(msg.text);
        break;
      case 'output_transcript':
      case 'text':
        this.transcript.addModel(msg.text);
        break;
      case 'tool_call':
        void this.runTools(msg.calls);
        break;
      case 'tool_cancel':
        for (const id of msg.ids) this.cancelled.add(id);
        break;
      case 'go_away':
        console.info(`[voice] server closing session in ${msg.timeLeft}; will reconnect on next talk`);
        break;
    }
    this.refresh();
  }

  private async runTools(calls: readonly FunctionCall[]): Promise<void> {
    this.pendingTools += calls.length;
    this.refresh();
    // Resolved per batch: the registry may have been rebuilt after `credentials-updated`.
    const registry = await this.deps.getRegistry();
    const ctx = { registry, applyCameraView: this.deps.applyCameraView };
    const responses = await Promise.all(calls.map((c) => executeToolCall(c, ctx)));
    this.pendingTools -= calls.length;
    const live = responses.filter((r) => !this.cancelled.delete(r.id));
    this.client?.sendToolResponse(live);
    const last = live.at(-1);
    if (last) setVoice({ lastAction: summarizeResponse(last) });
    this.touch();
    this.refresh();
  }

  private onClose(client: GeminiLiveClient, reason: string, code: number): void {
    if (this.client !== client) return;
    this.client = null;
    if (code === PROXY_CLOSE.noKey) setVoice({ needsKey: true });
    if (reason !== 'client closed' && reason !== 'idle') {
      this.fail(`Voice session ended: ${reason}`);
      void this.shutdown(false);
    }
    this.refresh();
  }

  private fail(message: string): void {
    console.warn('[voice]', message);
    this.micOpen = false;
    setVoice({ error: message, micMode: null });
  }

  /** Activity heartbeat: an idle session closes the socket and releases the mic. */
  private touch(): void {
    this.clearIdle();
    this.idleTimer = setTimeout(() => {
      if (this.micOpen || this.player.playing || this.pendingTools > 0) return this.touch();
      this.client?.close('idle');
      void this.shutdown(true);
    }, this.config.idleTimeoutMs ?? 90_000);
  }

  private clearIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private refresh(): void {
    const s = useVoiceStore.getState();
    const status: VoiceStatus =
      this.client?.state !== 'open'
        ? this.connecting ? 'connecting' : s.error ? 'error' : 'off'
        : this.player.playing ? 'speaking' : this.pendingTools > 0 ? 'thinking' : this.micOpen ? 'listening' : 'ready';
    if (status !== s.status) setVoice({ status });
  }
}
