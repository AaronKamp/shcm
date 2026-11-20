import { isJsonValue, isRecord, str, toJsonObject } from '../core/json';
import type { JsonObject, JsonValue } from '../core/types';
import toolSpec from '../../specs/gemini_live_tools.json';

/**
 * Wire types for the Gemini Live API (`BidiGenerateContent`, v1beta).
 * Inbound frames are untrusted: everything is narrowed through `parseServerMessage`.
 */

export const INPUT_SAMPLE_RATE = 16_000;
export const OUTPUT_SAMPLE_RATE = 24_000;
export const INPUT_MIME = `audio/pcm;rate=${INPUT_SAMPLE_RATE}`;

const isJsonObject = (v: unknown): v is JsonObject => isRecord(v) && isJsonValue(v);

/** Validated once at load; a malformed spec fails fast instead of at setup time. */
const loadDeclarations = (spec: unknown): readonly JsonObject[] => {
  if (!Array.isArray(spec) || !spec.every(isJsonObject)) throw new Error('specs/gemini_live_tools.json is malformed');
  return spec;
};

/** Tool declarations sent verbatim from specs/gemini_live_tools.json. */
export const FUNCTION_DECLARATIONS: readonly JsonObject[] = loadDeclarations(toolSpec);

export type ToolName = 'execute_smart_home_action' | 'control_camera_view' | 'manage_timer' | 'ask_google_home';

export interface LiveSetupOptions {
  /** Full model resource name, e.g. `models/gemini-2.5-flash-native-audio-preview-09-2025`. */
  readonly model: string;
  readonly systemInstruction: string;
  readonly voiceName?: string;
}

export interface FunctionCall {
  readonly id: string;
  readonly name: string;
  readonly args: JsonObject;
}

export interface FunctionResponse {
  readonly id: string;
  readonly name: string;
  readonly response: JsonObject;
}

export type ServerMessage =
  | { readonly kind: 'setup_complete' }
  | { readonly kind: 'audio'; readonly base64: string }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'interrupted' }
  | { readonly kind: 'turn_complete' }
  | { readonly kind: 'input_transcript'; readonly text: string }
  | { readonly kind: 'output_transcript'; readonly text: string }
  | { readonly kind: 'tool_call'; readonly calls: readonly FunctionCall[] }
  | { readonly kind: 'tool_cancel'; readonly ids: readonly string[] }
  | { readonly kind: 'go_away'; readonly timeLeft: string };

export const buildSetupMessage = (o: LiveSetupOptions): JsonObject => ({
  setup: {
    model: o.model.startsWith('models/') ? o.model : `models/${o.model}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: o.voiceName ?? 'Puck' } } },
    },
    systemInstruction: { parts: [{ text: o.systemInstruction }] },
    // Google Search grounding lets it answer weather, news and general questions.
    tools: [{ functionDeclarations: [...FUNCTION_DECLARATIONS] }, { googleSearch: {} }],
    realtimeInputConfig: {
      // Server VAD decides turn boundaries; user speech interrupts model audio.
      automaticActivityDetection: { disabled: false, silenceDurationMs: 600 },
      activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  },
});

export const buildAudioMessage = (base64Pcm: string): JsonObject => ({
  realtimeInput: { audio: { data: base64Pcm, mimeType: INPUT_MIME } },
});

/** Tells server VAD the mic closed (push-to-talk released) so it ends the turn now. */
export const buildAudioStreamEnd = (): JsonObject => ({ realtimeInput: { audioStreamEnd: true } });

export const buildToolResponse = (responses: readonly FunctionResponse[]): JsonObject => ({
  toolResponse: {
    functionResponses: responses.map((r): JsonValue => ({ id: r.id, name: r.name, response: r.response })),
  },
});

/**
 * One wire frame can carry several logical events (e.g. audio + transcript +
 * turnComplete), so this returns a list in the order they should be handled.
 */
export const parseServerMessage = (raw: unknown): ServerMessage[] => {
  if (!isRecord(raw)) return [];
  const out: ServerMessage[] = [];

  if ('setupComplete' in raw) out.push({ kind: 'setup_complete' });

  const toolCall = raw['toolCall'];
  if (isRecord(toolCall) && Array.isArray(toolCall['functionCalls'])) {
    const calls: FunctionCall[] = [];
    for (const fc of toolCall['functionCalls']) {
      if (!isRecord(fc)) continue;
      calls.push({ id: str(fc['id']), name: str(fc['name']), args: toJsonObject(fc['args']) });
    }
    if (calls.length) out.push({ kind: 'tool_call', calls });
  }

  const cancel = raw['toolCallCancellation'];
  if (isRecord(cancel) && Array.isArray(cancel['ids'])) {
    out.push({ kind: 'tool_cancel', ids: cancel['ids'].filter((x): x is string => typeof x === 'string') });
  }

  const goAway = raw['goAway'];
  if (isRecord(goAway)) out.push({ kind: 'go_away', timeLeft: str(goAway['timeLeft'], 'unknown') });

  const sc = raw['serverContent'];
  if (isRecord(sc)) {
    // Interruption first: stale audio must be flushed before anything new queues.
    if (sc['interrupted'] === true) out.push({ kind: 'interrupted' });
    const it = sc['inputTranscription'];
    if (isRecord(it) && str(it['text'])) out.push({ kind: 'input_transcript', text: str(it['text']) });
    const turn = sc['modelTurn'];
    if (isRecord(turn) && Array.isArray(turn['parts'])) {
      for (const part of turn['parts']) {
        if (!isRecord(part)) continue;
        const inline = part['inlineData'];
        if (isRecord(inline) && str(inline['mimeType']).startsWith('audio/pcm') && str(inline['data'])) {
          out.push({ kind: 'audio', base64: str(inline['data']) });
        } else if (typeof part['text'] === 'string' && part['text']) {
          out.push({ kind: 'text', text: part['text'] });
        }
      }
    }
    const ot = sc['outputTranscription'];
    if (isRecord(ot) && str(ot['text'])) out.push({ kind: 'output_transcript', text: str(ot['text']) });
    if (sc['turnComplete'] === true) out.push({ kind: 'turn_complete' });
  }
  return out;
};
