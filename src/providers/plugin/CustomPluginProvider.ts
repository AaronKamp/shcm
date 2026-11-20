import { BaseDeviceProvider, commandError, errorMessage } from '../../core/DeviceProvider';
import { makeUid, type CommandResult, type DeviceCommand, type JsonObject, type SmartEntity } from '../../core/types';
import { parseState, renderJson } from './pluginTemplate';
import { sendPluginRequest } from './pluginTransport';
import type { ParsedState, PluginDeviceSpec, PluginProviderConfig, TemplateContext } from './pluginTypes';

/** Throws a single error listing every problem in the config. */
export const validatePluginConfig = (config: PluginProviderConfig): void => {
  const problems: string[] = [];
  const ids = new Set<string>();
  const t = config.transports ?? {};
  for (const d of config.devices) {
    if (!d.id) problems.push(`device "${d.name}" has no id`);
    if (ids.has(d.id)) problems.push(`duplicate device id "${d.id}"`);
    ids.add(d.id);
    const kinds = [...Object.values(d.commands).map((c) => c.request.kind), d.state?.kind === 'poll' ? d.state.request.kind : d.state?.kind];
    if (kinds.includes('tcp') && !t.tcp) problems.push(`"${d.id}" uses TCP but no transports.tcp was provided`);
    if (kinds.includes('mqtt') && !t.mqtt) problems.push(`"${d.id}" uses MQTT but no transports.mqtt was provided`);
    if (d.state?.parse.type === 'regex') {
      try {
        new RegExp(d.state.parse.pattern);
      } catch {
        problems.push(`"${d.id}" has an invalid state regex`);
      }
    }
  }
  if (problems.length > 0) throw new Error(`Invalid plugin config:\n- ${problems.join('\n- ')}`);
};

/**
 * Config-driven adapter for non-HA devices (REST/webhooks, local HTTP, raw TCP, MQTT).
 * Every device lands in the same SmartEntity store as Home Assistant entities.
 * Registered as `custom_hook` to match the Gemini tool schema.
 */
export class CustomPluginProvider extends BaseDeviceProvider {
  readonly id = 'custom_hook';
  readonly displayName = 'Custom Plugins';

  private readonly specs = new Map<string, PluginDeviceSpec>();
  private readonly cleanups: Array<() => void> = [];
  private readonly timeoutMs: number;

  constructor(private readonly config: PluginProviderConfig) {
    super();
    validatePluginConfig(config);
    this.timeoutMs = config.defaultTimeoutMs ?? 5000;
    for (const d of config.devices) this.specs.set(d.id, d);
  }

  /** Device ids and the actions each supports (useful for Gemini tool descriptions). */
  describe(): ReadonlyArray<{ id: string; name: string; domain: string; actions: readonly string[] }> {
    return [...this.specs.values()].map((d) => ({ id: d.id, name: d.name, domain: d.domain, actions: Object.keys(d.commands) }));
  }

  async connect(): Promise<void> {
    this.setStatus('connecting');
    try {
      await this.config.transports?.mqtt?.connect();
      for (const spec of this.specs.values()) {
        this.write(spec, { state: spec.initialState ?? 'unknown', attributes: spec.attributes ?? {} });
        this.startStateSource(spec);
      }
      this.setStatus('connected');
    } catch (err: unknown) {
      this.setStatus('error', errorMessage(err));
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    while (this.cleanups.length > 0) this.cleanups.pop()?.();
    await this.config.transports?.mqtt?.disconnect();
    this.setStatus('disconnected');
  }

  async executeCommand(command: DeviceCommand): Promise<CommandResult> {
    const spec = this.specs.get(command.targetId);
    if (!spec) return commandError(`Unknown plugin device "${command.targetId}"`);
    const cmd = spec.commands[command.action];
    if (!cmd) {
      return commandError(`"${spec.name}" has no "${command.action}" action (available: ${Object.keys(spec.commands).join(', ')})`);
    }
    const ctx = this.context(spec, command.action, command.payload ?? {});
    let response: string;
    try {
      response = await sendPluginRequest(cmd.request, ctx, this.config.transports ?? {}, this.timeoutMs);
    } catch (err: unknown) {
      return commandError(errorMessage(err));
    }

    const current = this.entities.get(makeUid(this.id, spec.id));
    const parsed = cmd.parseResponse ? parseState(response, cmd.parseResponse) : null;
    const patch = cmd.resultAttributes ? renderJson(cmd.resultAttributes, ctx) : {};
    const attributes: JsonObject = { ...current?.attributes, ...(parsed?.attributes ?? {}), ...(isObj(patch) ? patch : {}) };
    const state = parsed?.state ?? cmd.resultState ?? current?.state ?? 'unknown';
    this.write(spec, { state, attributes });
    return { ok: true, message: `${spec.name}: ${command.action}`, ...(response ? { data: response.slice(0, 2000) } : {}) };
  }

  private startStateSource(spec: PluginDeviceSpec): void {
    const source = spec.state;
    if (!source) return;
    if (source.kind === 'mqtt') {
      const mqtt = this.config.transports?.mqtt;
      if (!mqtt) return;
      this.cleanups.push(
        mqtt.subscribe(source.topic, (raw) => {
          const parsed = parseState(raw, source.parse);
          if (parsed) this.write(spec, parsed);
        }),
      );
      return;
    }
    let inFlight = false;
    const poll = (): void => {
      if (inFlight) return;
      inFlight = true;
      sendPluginRequest(source.request, this.context(spec, 'poll', {}), this.config.transports ?? {}, this.timeoutMs)
        .then((raw) => {
          const parsed = parseState(raw, source.parse);
          if (parsed) this.write(spec, parsed);
        })
        .catch(() => this.markUnavailable(spec))
        .finally(() => {
          inFlight = false;
        });
    };
    poll();
    const timer = setInterval(poll, source.intervalMs ?? this.config.defaultPollMs ?? 15_000);
    this.cleanups.push(() => clearInterval(timer));
  }

  private context(spec: PluginDeviceSpec, action: string, payload: JsonObject): TemplateContext {
    return { action, target: spec.id, payload, env: this.config.env ?? {} };
  }

  private markUnavailable(spec: PluginDeviceSpec): void {
    const cur = this.entities.get(makeUid(this.id, spec.id));
    if (cur?.available) this.upsertEntity({ ...cur, available: false, lastUpdated: Date.now() });
  }

  /** Maps parsed state into the shared SmartEntity shape. Skips no-op updates. */
  private write(spec: PluginDeviceSpec, next: ParsedState): void {
    const uid = makeUid(this.id, spec.id);
    const prev = this.entities.get(uid);
    const attributes: JsonObject = { ...spec.attributes, ...next.attributes, friendly_name: spec.name };
    const available = next.state !== 'unavailable';
    if (prev && prev.state === next.state && prev.available === available && JSON.stringify(prev.attributes) === JSON.stringify(attributes)) {
      return;
    }
    const now = Date.now();
    const entity: SmartEntity = {
      uid,
      nativeId: spec.id,
      providerId: this.id,
      domain: spec.domain,
      name: spec.name,
      state: next.state,
      attributes,
      lastChanged: prev && prev.state === next.state ? prev.lastChanged : now,
      lastUpdated: now,
      available,
      ...(spec.area === undefined ? {} : { area: spec.area }),
    };
    this.upsertEntity(entity);
  }
}

const isObj = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
