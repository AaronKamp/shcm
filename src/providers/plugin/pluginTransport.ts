import type { HttpRequestSpec, MqttRequestSpec, PluginRequestSpec, PluginTransports, TcpRequestSpec, TemplateContext } from './pluginTypes';
import { renderJson, renderString } from './pluginTemplate';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.replace(/[\s:,-]|0x/gi, '');
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) throw new Error(`Invalid hex payload "${hex}"`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/** Sends one templated request and resolves with the response as text. */
export const sendPluginRequest = async (
  spec: PluginRequestSpec,
  ctx: TemplateContext,
  transports: PluginTransports,
  defaultTimeoutMs: number,
): Promise<string> => {
  switch (spec.kind) {
    case 'http':
      return sendHttp(spec, ctx, transports.fetch ?? ((i, init) => fetch(i, init)), defaultTimeoutMs);
    case 'tcp':
      return sendTcp(spec, ctx, transports, defaultTimeoutMs);
    case 'mqtt':
      return sendMqtt(spec, ctx, transports);
  }
};

const sendHttp = async (spec: HttpRequestSpec, ctx: TemplateContext, fetchImpl: typeof fetch, defaultTimeoutMs: number): Promise<string> => {
  const method = spec.method ?? (spec.body === undefined ? 'GET' : 'POST');
  const url = renderString(spec.url, ctx);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(spec.headers ?? {})) headers[k] = renderString(v, ctx);

  const init: RequestInit = { method, headers };
  if (spec.body !== undefined && method !== 'GET') {
    const rendered = renderJson(spec.body, ctx);
    if (typeof rendered === 'string') {
      init.body = rendered;
    } else {
      init.body = JSON.stringify(rendered);
      if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), spec.timeoutMs ?? defaultTimeoutMs);
  init.signal = controller.signal;
  try {
    const res = await fetchImpl(url, init);
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${url} → HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
    return text;
  } catch (err: unknown) {
    if (controller.signal.aborted) throw new Error(`${method} ${url} timed out`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

const sendTcp = async (spec: TcpRequestSpec, ctx: TemplateContext, transports: PluginTransports, defaultTimeoutMs: number): Promise<string> => {
  if (!transports.tcp) throw new Error('TCP command configured but no TcpClient transport was provided');
  const payload = renderString(spec.payload, ctx);
  const data = spec.encoding === 'hex' ? hexToBytes(payload) : encoder.encode(payload + (spec.lineEnding ?? '\r\n'));
  const reply = await transports.tcp.request({
    host: renderString(spec.host, ctx),
    port: spec.port,
    data,
    readUntil: spec.readUntil ?? 'line',
    timeoutMs: spec.timeoutMs ?? defaultTimeoutMs,
  });
  if (spec.encoding === 'hex') return [...reply].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  return decoder.decode(reply);
};

const sendMqtt = async (spec: MqttRequestSpec, ctx: TemplateContext, transports: PluginTransports): Promise<string> => {
  if (!transports.mqtt) throw new Error('MQTT command configured but no MqttClient transport was provided');
  const rendered = spec.payload === undefined ? { action: ctx.action, ...ctx.payload } : renderJson(spec.payload, ctx);
  const body = typeof rendered === 'string' ? rendered : JSON.stringify(rendered);
  const options: { retain?: boolean; qos?: 0 | 1 | 2 } = {};
  if (spec.retain !== undefined) options.retain = spec.retain;
  if (spec.qos !== undefined) options.qos = spec.qos;
  await transports.mqtt.publish(renderString(spec.topic, ctx), body, options);
  return '';
};
