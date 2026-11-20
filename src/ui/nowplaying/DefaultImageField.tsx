import { ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNowPlayingStore } from '../../state/nowPlayingStore';

/** Longest side of the saved picture; keeps it small enough for local storage. */
const MAX_SIDE = 600;

/** Reads an image file and re-encodes it as a JPEG data URL no larger than MAX_SIDE. */
const shrink = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Could not process the picture'));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file isn't a picture this app can read"));
    };
    img.src = url;
  });

/** Pick, preview and remove the card's default picture. */
export function DefaultImageField() {
  const image = useNowPlayingStore((s) => s.defaultImage);
  const { setDefaultImage } = useNowPlayingStore.getState();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = (file: File | undefined): void => {
    if (!file) return;
    setError(null);
    shrink(file)
      .then(setDefaultImage)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  return (
    <section className="flex flex-col gap-2" aria-label="Default picture">
      <h3 className="text-sm font-semibold text-slate-200">Default picture</h3>
      <p className="text-xs text-slate-400">Shown when there's no album art, artist photo or app logo.</p>
      <div className="flex items-center gap-3">
        {image ? (
          <img src={image} alt="Default picture" className="h-16 w-16 rounded-lg object-cover" />
        ) : (
          <span className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-line text-xs text-slate-500">None</span>
        )}
        <button type="button" onClick={() => input.current?.click()} className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-sm text-slate-200 hover:bg-panel-hi">
          <ImagePlus className="h-4 w-4" aria-hidden /> {image ? 'Change' : 'Choose picture'}
        </button>
        {image && (
          <button type="button" onClick={() => setDefaultImage(null)} aria-label="Remove default picture" className="rounded-md p-1.5 text-slate-400 hover:bg-panel-hi hover:text-bad">
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
    </section>
  );
}
