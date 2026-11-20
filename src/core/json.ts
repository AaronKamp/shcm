import type { JsonObject, JsonValue } from './types';

/** Narrowing helpers so untrusted wire payloads never become `any`. */

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

export const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export const isJsonValue = (v: unknown): v is JsonValue => {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isJsonValue);
  if (isRecord(v)) return Object.values(v).every(isJsonValue);
  return false;
};

/** Keeps only JSON-safe fields of an object. */
export const toJsonObject = (v: unknown): JsonObject => {
  const out: JsonObject = {};
  if (!isRecord(v)) return out;
  for (const [k, val] of Object.entries(v)) if (isJsonValue(val)) out[k] = val;
  return out;
};

export const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

export const parseTime = (v: unknown, fallback: number): number => {
  if (typeof v !== 'string') return fallback;
  const t = Date.parse(v);
  return Number.isNaN(t) ? fallback : t;
};

export const slugify = (name: string): string =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
