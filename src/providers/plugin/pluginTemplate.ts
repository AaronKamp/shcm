import { isJsonValue, isRecord, parseJson, toJsonObject } from '../../core/json';
import type { JsonObject, JsonValue } from '../../core/types';
import type { ParsedState, StateParserSpec, TemplateContext } from './pluginTypes';

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;
const WHOLE_PLACEHOLDER = /^\{\{\s*([\w.]+)\s*\}\}$/;

/** Reads `a.b.c` from an object. Returns undefined for missing paths. */
export const getPath = (source: unknown, path: string): unknown => {
  let cur: unknown = source;
  for (const key of path.split('.')) {
    if (Array.isArray(cur) && /^\d+$/.test(key)) cur = cur[Number(key)];
    else if (isRecord(cur)) cur = cur[key];
    else return undefined;
  }
  return cur;
};

const lookup = (ctx: TemplateContext, path: string): unknown => {
  if (path === 'action') return ctx.action;
  if (path === 'target') return ctx.target;
  return getPath({ payload: ctx.payload, env: ctx.env }, path);
};

const stringify = (v: unknown): string => {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  return isJsonValue(v) ? (typeof v === 'object' ? JSON.stringify(v) : String(v)) : '';
};

/** Substitutes placeholders in a string. Missing values become empty strings. */
export const renderString = (template: string, ctx: TemplateContext): string =>
  template.replace(PLACEHOLDER, (_m, path: string) => stringify(lookup(ctx, path)));

/** Deep-renders a JSON value; an exact `"{{x}}"` keeps x's original JSON type. */
export const renderJson = (template: JsonValue, ctx: TemplateContext): JsonValue => {
  if (typeof template === 'string') {
    const whole = WHOLE_PLACEHOLDER.exec(template);
    if (whole?.[1]) {
      const v = lookup(ctx, whole[1]);
      return isJsonValue(v) ? v : null;
    }
    return renderString(template, ctx);
  }
  if (Array.isArray(template)) return template.map((t) => renderJson(t, ctx));
  if (template !== null && typeof template === 'object') {
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(template)) out[k] = renderJson(v, ctx);
    return out;
  }
  return template;
};

const applyMap = (value: string, map?: Readonly<Record<string, string>>): string => map?.[value] ?? map?.[value.toLowerCase()] ?? value;

/** Parses a response body according to the device's parser spec. Returns null if it doesn't match. */
export const parseState = (raw: string, spec: StateParserSpec): ParsedState | null => {
  switch (spec.type) {
    case 'text': {
      const value = raw.trim();
      return value ? { state: applyMap(value, spec.map), attributes: {} } : null;
    }
    case 'regex': {
      const match = new RegExp(spec.pattern).exec(raw);
      const value = match?.[spec.group ?? 1] ?? match?.[0];
      return value === undefined ? null : { state: applyMap(value.trim(), spec.map), attributes: { raw: raw.trim() } };
    }
    case 'json': {
      const body = parseJson(raw);
      const value = getPath(body, spec.stateField);
      if (value === undefined || value === null) return null;
      let attributes: JsonObject;
      if (spec.attributeFields) {
        attributes = {};
        for (const path of spec.attributeFields) {
          const v = getPath(body, path);
          const key = path.split('.').pop() ?? path;
          if (isJsonValue(v)) attributes[key] = v;
        }
      } else {
        attributes = toJsonObject(body);
      }
      return { state: applyMap(stringify(value), spec.map), attributes };
    }
  }
};
