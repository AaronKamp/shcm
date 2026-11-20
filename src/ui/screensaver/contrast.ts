/** Brightness of one horizontal band of the photo as it's shown (cover-cropped). */
export interface BandStats {
  /** Mean relative luminance, 0–1. */
  readonly luminance: number;
  /** Standard deviation of luminance: busy photos need a stronger scrim. */
  readonly busyness: number;
}

export interface PhotoStats {
  readonly top: BandStats;
  readonly bottom: BandStats;
}

const W = 64;
const H = 36;
/** Overlay bands: top and bottom ~22% of the screen. */
const BAND_ROWS = 8;

const FALLBACK: PhotoStats = { top: { luminance: 0.5, busyness: 0.25 }, bottom: { luminance: 0.5, busyness: 0.25 } };

const band = (data: Uint8ClampedArray, fromRow: number): BandStats => {
  let sum = 0;
  let sq = 0;
  const n = BAND_ROWS * W;
  for (let y = fromRow; y < fromRow + BAND_ROWS; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const l = (0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0)) / 255;
      sum += l;
      sq += l * l;
    }
  }
  const mean = sum / n;
  return { luminance: mean, busyness: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
};

/** Samples a decoded image at screen aspect. Cross-origin images without CORS fall back to neutral. */
export const analyzePhoto = (img: HTMLImageElement, screenAspect: number): PhotoStats => {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || !img.naturalWidth) return FALLBACK;
    const imgAspect = img.naturalWidth / img.naturalHeight;
    // Cover crop, centered, matching how the backdrop is drawn.
    let sw = img.naturalWidth;
    let sh = img.naturalHeight;
    if (imgAspect > screenAspect) sw = sh * screenAspect;
    else sh = sw / screenAspect;
    ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);
    return { top: band(data, 0), bottom: band(data, H - BAND_ROWS) };
  } catch {
    return FALLBACK;
  }
};

export type OverlayTone = 'light' | 'dark';

/** Dark text only on calm, bright areas; everything else gets white text over a dark scrim. */
export const toneFor = (b: BandStats): OverlayTone => (b.luminance > 0.62 && b.busyness < 0.16 ? 'dark' : 'light');

/** Scrim opacity 0–0.6: more for mid-tones and busy areas where text gets lost. */
export const scrimFor = (b: BandStats, tone: OverlayTone): number => {
  const clash = tone === 'light' ? b.luminance : 1 - b.luminance;
  return Math.min(0.6, Math.max(0.12, clash * 0.55 + b.busyness * 0.8));
};
