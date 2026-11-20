import { invoke } from '@tauri-apps/api/core';
import { inTauri } from './window';

/** HA-relative image path → data URL, shared across components; failures are cached too. */
const cache = new Map<string, Promise<string>>();
const MAX_ENTRIES = 200;

/**
 * Makes an image source loadable by the webview. Absolute http(s) URLs pass
 * through; HA-relative `/api/…` paths (album art, library thumbnails) are
 * fetched by the Rust side with the stored token and returned as data URLs.
 */
export const resolveImage = (src: string): Promise<string> => {
  if (/^(https?:|data:image\/)/i.test(src)) return Promise.resolve(src);
  if (!src.startsWith('/api/') || !inTauri()) return Promise.reject(new Error('Image not loadable here'));
  let hit = cache.get(src);
  if (!hit) {
    if (cache.size >= MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    hit = invoke<string>('ha_media_image', { path: src });
    cache.set(src, hit);
  }
  return hit;
};
