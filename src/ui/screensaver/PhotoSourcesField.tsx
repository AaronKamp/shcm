import { FolderPlus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../core/DeviceProvider';
import { listPhotos, pickPhotoFolders, suggestedPhotoFolders, type LinkStatus, type SuggestedFolder } from '../../platform/photos';
import { updateScreensaver, useScreensaverStore } from '../../state/screensaverStore';
import { CloudLinksField } from './CloudLinksField';

const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).at(-1) ?? p;

/**
 * Photo sources: detected cloud-sync and picture folders as checkboxes, plus
 * any folder from the native picker. Shows how many photos the choice finds.
 */
export function PhotoSourcesField() {
  const folders = useScreensaverStore((s) => s.folders);
  const recursive = useScreensaverStore((s) => s.includeSubfolders);
  const links = useScreensaverStore((s) => s.links);
  const [suggested, setSuggested] = useState<SuggestedFolder[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [statuses, setStatuses] = useState<LinkStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    suggestedPhotoFolders().then(setSuggested, (err: unknown) => setError(errorMessage(err)));
  }, []);

  useEffect(() => {
    let live = true;
    setCount(null);
    setStatuses(null);
    setError(null);
    listPhotos({ folders, recursive, links }).then(
      (res) => {
        if (!live) return;
        setCount(res.urls.length);
        setStatuses(res.links);
      },
      (err: unknown) => live && setError(errorMessage(err)),
    );
    return () => {
      live = false;
    };
  }, [folders, recursive, links]);

  const toggle = (path: string, on: boolean): void =>
    updateScreensaver({ folders: on ? [...folders.filter((f) => f !== path), path] : folders.filter((f) => f !== path) });

  const add = async (): Promise<void> => {
    try {
      const picked = await pickPhotoFolders();
      if (picked.length) updateScreensaver({ folders: [...new Set([...folders, ...picked])] });
    } catch (err: unknown) {
      setError(errorMessage(err));
    }
  };

  const custom = folders.filter((f) => !suggested.some((s) => s.path === f));

  return (
    <fieldset className="mt-3">
      <legend className="mb-1 text-xs text-slate-300">Photo sources</legend>
      <ul className="space-y-1">
        {suggested.map((s) => (
          <li key={s.path}>
            <label className="flex items-center gap-2 text-xs text-slate-200" title={s.path}>
              <input type="checkbox" checked={folders.includes(s.path)} onChange={(e) => toggle(s.path, e.target.checked)} className="accent-accent" />
              <span className="font-medium">{s.label}</span>
              <span className="truncate text-slate-500">{s.path}</span>
            </label>
          </li>
        ))}
        {custom.map((f) => (
          <li key={f} className="flex items-center gap-2 text-xs text-slate-200" title={f}>
            <input type="checkbox" checked readOnly className="accent-accent" aria-label={`${baseName(f)} included`} />
            <span className="font-medium">{baseName(f)}</span>
            <span className="min-w-0 flex-1 truncate text-slate-500">{f}</span>
            <button type="button" onClick={() => toggle(f, false)} aria-label={`Remove ${baseName(f)}`} className="rounded p-0.5 text-slate-500 hover:bg-panel-hi hover:text-slate-100">
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void add()} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-slate-200 hover:bg-panel-hi">
          <FolderPlus className="h-3.5 w-3.5" aria-hidden /> Add folder…
        </button>
        <label className="flex items-center gap-1.5 text-xs text-slate-300">
          <input type="checkbox" checked={recursive} onChange={(e) => updateScreensaver({ includeSubfolders: e.target.checked })} className="accent-accent" />
          Include subfolders
        </label>
        <span className="text-xs text-slate-500" role="status">
          {error ? <span className="text-bad">{error}</span> : count === null ? 'Counting…' : `${count.toLocaleString()} photo${count === 1 ? '' : 's'}`}
        </span>
      </div>
      <p className="mt-1.5 text-xs text-slate-500">Folders can be local or synced by a cloud app (OneDrive, Google Drive, Dropbox, iCloud).</p>
      <CloudLinksField links={links} statuses={statuses} />
    </fieldset>
  );
}
