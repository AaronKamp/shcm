import { errorMessage } from '../core/DeviceProvider';
import { isRecord, str, toJsonObject } from '../core/json';
import type { ProviderRegistry } from '../core/ProviderRegistry';
import type { JsonObject, ProviderId } from '../core/types';
import type { CameraViewMode } from '../state/viewStore';
import { askGoogleHome, manageTimer } from './extraTools';
import type { FunctionCall, FunctionResponse } from './protocol';

export interface ToolContext {
  readonly registry: ProviderRegistry;
  /** Camera view state lives per window (viewStore); injected to keep this layer UI-free. */
  readonly applyCameraView: (uid: string, mode: CameraViewMode) => void;
}

const TOOL_PROVIDERS = new Set(['home_assistant', 'custom_hook']);
const VIEW_MODES = new Set<string>(['pip_overlay', 'fullscreen', 'grid', 'close']);
const TOOL_TIMEOUT_MS = 8000;

const isViewMode = (v: string): v is CameraViewMode => VIEW_MODES.has(v);

const fail = (error: string): JsonObject => ({ ok: false, error });

/**
 * Executes one Gemini `functionCall` and always produces a `functionResponse`
 * (errors included) so the model can tell the user what happened.
 */
export const executeToolCall = async (call: FunctionCall, ctx: ToolContext): Promise<FunctionResponse> => {
  let response: JsonObject;
  try {
    response = await withTimeout(dispatch(call, ctx), TOOL_TIMEOUT_MS);
  } catch (err: unknown) {
    response = fail(errorMessage(err));
  }
  return { id: call.id, name: call.name, response };
};

/** Short UI label for the voice pill, e.g. "Kitchen Lights ✓". */
export const summarizeResponse = (r: FunctionResponse): string => {
  const fallback = r.name === 'manage_timer' ? 'Timer' : r.name === 'ask_google_home' ? 'Google Home' : r.name;
  const target = String(r.response['camera'] ?? r.response['target_id'] ?? r.response['label'] ?? fallback);
  return `${target} ${r.response['ok'] === true ? '✓' : '✕'}`;
};

const dispatch = (call: FunctionCall, ctx: ToolContext): Promise<JsonObject> => {
  switch (call.name) {
    case 'execute_smart_home_action':
      return smartHomeAction(call.args, ctx.registry);
    case 'control_camera_view':
      return Promise.resolve(cameraView(call.args, ctx));
    case 'manage_timer':
      return Promise.resolve(manageTimer(call.args));
    case 'ask_google_home':
      return askGoogleHome(call.args, ctx.registry);
    default:
      return Promise.resolve(fail(`Unknown tool "${call.name}"`));
  }
};

const smartHomeAction = async (args: JsonObject, registry: ProviderRegistry): Promise<JsonObject> => {
  const provider = str(args['provider']);
  const domain = str(args['domain']).trim();
  const action = str(args['action']).trim();
  const targetId = str(args['target_id']).trim();
  if (!TOOL_PROVIDERS.has(provider)) return fail(`provider must be home_assistant or custom_hook, got "${provider}"`);
  if (!domain || !action || !targetId) return fail('domain, action and target_id are required');

  const providerId = resolveProvider(registry, provider, targetId);
  if (!providerId) return fail(`No connected provider has device "${targetId}"`);

  const payload = isRecord(args['payload']) ? toJsonObject(args['payload']) : undefined;
  const result = await registry.executeCommand(
    payload ? { providerId, domain, action, targetId, payload } : { providerId, domain, action, targetId },
  );
  const out: JsonObject = { ok: result.ok, target_id: targetId, action: `${domain}.${action}` };
  if (result.message !== undefined) out[result.ok ? 'message' : 'error'] = result.message;
  if (result.data !== undefined) out['data'] = result.data;
  return out;
};

/**
 * The tool enum only names home_assistant / custom_hook. If the requested
 * provider isn't registered (e.g. offline mock mode, or the model picked the
 * wrong one) route to whichever registered provider owns that native id.
 */
const resolveProvider = (registry: ProviderRegistry, requested: string, targetId: string): ProviderId | undefined => {
  const snap = registry.snapshot();
  const owner = [...snap.entities.values()].find((e) => e.nativeId === targetId)?.providerId;
  if (registry.get(requested) && (owner === undefined || owner === requested)) return requested;
  return owner;
};

const cameraView = (args: JsonObject, ctx: ToolContext): JsonObject => {
  const query = str(args['camera_id']).trim();
  const mode = str(args['view_mode']);
  if (!query) return fail('camera_id is required');
  if (!isViewMode(mode)) return fail(`view_mode must be one of ${[...VIEW_MODES].join(', ')}`);

  const camera = ctx.registry.findCamera(query) ?? fuzzyCamera(ctx.registry, query);
  if (!camera) {
    const known = [...ctx.registry.snapshot().cameras.values()].map((c) => c.slug);
    return fail(`Unknown camera "${query}". Available: ${known.join(', ') || 'none'}`);
  }
  ctx.applyCameraView(camera.uid, mode);
  const out: JsonObject = { ok: true, camera: camera.name, view_mode: mode };
  if (!camera.online && mode !== 'close') out['warning'] = `${camera.name} is offline`;
  return out;
};

/** "the driveway cam" → driveway. Matches if either slug contains the other. */
const fuzzyCamera = (registry: ProviderRegistry, query: string) => {
  const q = query.toLowerCase().replace(/\b(the|camera|cam)\b/g, '').trim().replace(/\s+/g, '_');
  if (!q) return undefined;
  return [...registry.snapshot().cameras.values()].find((c) => c.slug.includes(q) || q.includes(c.slug));
};

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
