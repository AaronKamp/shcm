import { Download, FileUp, Upload } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../core/DeviceProvider';
import { exportBackup, pickBackup, reloadAfterRestore, restoreBackup } from '../platform/backup';

const MIN = 8;
const input = 'w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-accent';
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Export everything (layout, groups, screensaver, shortcuts, credentials) to one
 * passphrase-protected file, and restore it here or on another device. The file
 * can live anywhere: a USB drive, OneDrive, a network share.
 */
export function BackupSettings() {
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [file, setFile] = useState<string | null>(null);
  const [restorePass, setRestorePass] = useState('');
  const [busy, setBusy] = useState<'export' | 'pick' | 'restore' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (kind: 'export' | 'pick' | 'restore', task: () => Promise<void>): Promise<void> => {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      await task();
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const onExport = (e: FormEvent): void => {
    e.preventDefault();
    void run('export', async () => {
      const res = await exportBackup(pass);
      if (!res) return;
      setPass('');
      setConfirm('');
      setNotice(`Saved ${res.file_name}: ${plural(res.settings, 'setting group')} and ${plural(res.secrets, 'credential')}.`);
    });
  };

  const onPick = (): void => void run('pick', async () => setFile((await pickBackup()) ?? file));

  const onRestore = (e: FormEvent): void => {
    e.preventDefault();
    if (!window.confirm("Replace this device's settings, shortcuts and saved credentials with the backup? The app reloads afterwards.")) return;
    void run('restore', async () => {
      const res = await restoreBackup(restorePass);
      setRestorePass('');
      setNotice(`Restored ${plural(res.settings, 'setting group')} and ${plural(res.secrets, 'credential')} from ${res.created.toLocaleDateString()}. Reloading…`);
      setTimeout(() => void reloadAfterRestore(), 1200);
    });
  };

  const mismatch = confirm.length > 0 && confirm !== pass;

  return (
    <section className="mb-5">
      <h3 className="mb-1 text-sm font-semibold text-slate-200">Backup &amp; restore</h3>
      <p className="mb-3 text-xs text-slate-400">
        One file with your layout, groups, screensaver, shortcuts and saved credentials, encrypted with a passphrase. Save it to a USB drive or any folder, then
        restore it on this device or others. Without the passphrase the file can’t be opened, and it can’t be recovered if you forget it.
      </p>

      <form onSubmit={onExport} className="mb-3 rounded-xl border border-line bg-panel p-3">
        <h4 className="mb-2 text-sm font-medium">Export</h4>
        <div className="mb-2 grid gap-2 sm:grid-cols-2">
          <input type="password" autoComplete="new-password" placeholder={`Passphrase (${MIN}+ characters)`} value={pass} onChange={(e) => setPass(e.target.value)} className={input} aria-label="Backup passphrase" />
          <input type="password" autoComplete="new-password" placeholder="Repeat passphrase" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={input} aria-label="Repeat backup passphrase" />
        </div>
        {mismatch && <p className="mb-2 text-xs text-bad">Passphrases don’t match.</p>}
        <button
          type="submit"
          disabled={busy !== null || pass.length < MIN || confirm !== pass}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          <Download className="h-4 w-4" aria-hidden /> {busy === 'export' ? 'Encrypting…' : 'Export backup…'}
        </button>
      </form>

      <form onSubmit={onRestore} className="rounded-xl border border-line bg-panel p-3">
        <h4 className="mb-2 text-sm font-medium">Restore</h4>
        <div className="mb-2 flex items-center gap-2">
          <button type="button" onClick={onPick} disabled={busy !== null} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-slate-200 hover:bg-panel-hi disabled:opacity-40">
            <FileUp className="h-3.5 w-3.5" aria-hidden /> Choose backup…
          </button>
          <span className="min-w-0 truncate text-xs text-slate-400">{file ?? 'From a USB drive, OneDrive or any folder'}</span>
        </div>
        {file && (
          <div className="flex items-center gap-2">
            <input type="password" autoComplete="off" placeholder="Backup passphrase" value={restorePass} onChange={(e) => setRestorePass(e.target.value)} className={input} aria-label="Passphrase for the chosen backup" />
            <button type="submit" disabled={busy !== null || !restorePass} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
              <Upload className="h-4 w-4" aria-hidden /> {busy === 'restore' ? 'Restoring…' : 'Restore'}
            </button>
          </div>
        )}
      </form>

      {error && <p className="mt-2 text-xs text-bad">{error}</p>}
      {notice && !error && (
        <p role="status" className="mt-2 text-xs text-ok">
          {notice}
        </p>
      )}
    </section>
  );
}
