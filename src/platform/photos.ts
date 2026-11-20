import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { inTauri } from './window';

/** Must match `SCHEME` in src-tauri/src/photos.rs. */
const PHOTO_SCHEME = 'shcmphoto';

/** Must match `SuggestedFolder` in src-tauri/src/photos.rs. */
export interface SuggestedFolder {
  readonly label: string;
  readonly path: string;
}

/** Colorful gradient "photos" so the screensaver can be previewed in a plain browser. */
const demoPhotos = (): string[] =>
  [
    ['#0f2027', '#2c5364', '#f8b500'],
    ['#fdfcfb', '#e2d1c3', '#c9d6ff'],
    ['#232526', '#414345', '#ff512f'],
    ['#a8e063', '#56ab2f', '#fffbd5'],
    ['#141e30', '#243b55', '#e0eafc'],
  ].map(([a, b, c], i) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="${i === 2 ? 2000 : 1000}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".6" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${400 + i * 200}" cy="400" r="180" fill="${c}" opacity=".5"/></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });

export type CloudService = 'google_photos' | 'amazon_photos' | 'one_drive';

/** Must match `LinkStatus` in src-tauri/src/photos.rs. */
export interface LinkStatus {
  readonly link: string;
  readonly service: CloudService | null;
  readonly count: number;
  readonly error: string | null;
}

/** Must match `PhotoList` in src-tauri/src/photos.rs. */
interface PhotoList {
  readonly photos: string[];
  readonly links: LinkStatus[];
}

export interface PhotoSources {
  readonly folders: readonly string[];
  readonly recursive: boolean;
  /** Public share links (Google Photos, Amazon Photos, OneDrive). */
  readonly links: readonly string[];
}

export interface ListedPhotos {
  readonly urls: string[];
  readonly links: LinkStatus[];
}

/**
 * Image URLs for the chosen folders and share links. The native side only
 * serves photos from the latest call; cloud photos come back as opaque keys.
 */
export const listPhotos = async ({ folders, recursive, links }: PhotoSources): Promise<ListedPhotos> => {
  if (!inTauri()) return { urls: demoPhotos(), links: [] };
  if (!folders.length && !links.length) return { urls: [], links: [] };
  const res = await invoke<PhotoList>('photo_list', { folders, recursive, links });
  return { urls: res.photos.map((p) => convertFileSrc(p, PHOTO_SCHEME)), links: res.links };
};

/** Same check as `cloud_photos::detect`, for instant feedback while typing. */
export const detectService = (link: string): CloudService | null => {
  let u: URL;
  try {
    u = new URL(link.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'photos.app.goo.gl' || (host === 'photos.google.com' && u.pathname.includes('/share/'))) return 'google_photos';
  if (host.startsWith('amazon.') && /\/(photos|clouddrive)\/share\//.test(u.pathname)) return 'amazon_photos';
  if (['1drv.ms', 'onedrive.live.com', 'onedrive.com', 'photos.onedrive.com'].includes(host)) return 'one_drive';
  return null;
};

export const SERVICE_LABEL: Record<CloudService, string> = {
  google_photos: 'Google Photos',
  amazon_photos: 'Amazon Photos',
  one_drive: 'OneDrive',
};

export const suggestedPhotoFolders = (): Promise<SuggestedFolder[]> =>
  inTauri() ? invoke<SuggestedFolder[]>('photo_suggested_folders') : Promise.resolve([]);

/** Native multi-folder picker; resolves to [] when cancelled. */
export const pickPhotoFolders = async (): Promise<string[]> => {
  if (!inTauri()) return [];
  const picked = await open({ directory: true, multiple: true, title: 'Choose photo folders' });
  if (picked === null) return [];
  return Array.isArray(picked) ? picked : [picked];
};
