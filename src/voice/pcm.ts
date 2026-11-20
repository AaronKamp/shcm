/** PCM helpers. Gemini Live audio is 16-bit signed little-endian mono in both directions. */

const B64_CHUNK = 0x8000;

export const bytesToBase64 = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + B64_CHUNK));
  }
  return btoa(bin);
};

/** Decodes base64 LE int16 PCM straight to Float32 [-1, 1) for Web Audio. */
export const base64PcmToFloat32 = (b64: string): Float32Array => {
  const bin = atob(b64);
  const n = bin.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lo = bin.charCodeAt(2 * i);
    const hi = bin.charCodeAt(2 * i + 1);
    const v = (hi << 8) | lo;
    out[i] = (v >= 0x8000 ? v - 0x10000 : v) / 0x8000;
  }
  return out;
};

/** Linear resample, used only when the platform refuses a 24kHz AudioContext. */
export const resampleLinear = (input: Float32Array, fromRate: number, toRate: number): Float32Array => {
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = (input[i0] ?? 0) * (1 - frac) + (input[i1] ?? 0) * frac;
  }
  return out;
};
