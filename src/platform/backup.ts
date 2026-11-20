import { invoke } from '@tauri-apps/api/core';

/** Must match `Exported` in src-tauri/src/backup.rs. */
export interface BackupExported {
  readonly file_name: string;
  readonly settings: number;
  readonly secrets: number;
}

/** Must match `Restored` in src-tauri/src/backup.rs. Credentials are restored natively and never appear here. */
interface BackupRestored {
  readonly settings: Record<string, string>;
  readonly secrets: number;
  readonly shortcuts: boolean;
  readonly created: number;
}

const PREFIX = 'shcm.';
/** Running timers belong to this device and moment; they aren't carried over. */
const DEVICE_ONLY = new Set(['shcm.timers.v1']);

const portable = (key: string): boolean => key.startsWith(PREFIX) && !DEVICE_ONLY.has(key);

const localSettings = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const value = key === null ? null : localStorage.getItem(key);
    if (key && value !== null && portable(key)) out[key] = value;
  }
  return out;
};

const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Encrypts settings + shortcuts + credentials and opens a native save dialog. Null = cancelled. */
export const exportBackup = (passphrase: string): Promise<BackupExported | null> =>
  invoke<BackupExported | null>('backup_export', { passphrase, settings: localSettings(), stamp: today() });

/** Native open dialog (any drive, including USB). Resolves to the file name, or null if cancelled. */
export const pickBackup = (): Promise<string | null> => invoke<string | null>('backup_pick');

export interface RestoreSummary {
  readonly settings: number;
  readonly secrets: number;
  readonly shortcuts: boolean;
  readonly created: Date;
}

/**
 * Restores the picked backup: credentials and shortcuts natively, then this
 * device's settings are replaced with the backup's. Call `reloadAfterRestore` next.
 */
export const restoreBackup = async (passphrase: string): Promise<RestoreSummary> => {
  const res = await invoke<BackupRestored>('backup_import', { passphrase });
  const stale: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && portable(key) && !(key in res.settings)) stale.push(key);
  }
  for (const key of stale) localStorage.removeItem(key);
  for (const [key, value] of Object.entries(res.settings)) if (portable(key)) localStorage.setItem(key, value);
  return { settings: Object.keys(res.settings).length, secrets: res.secrets, shortcuts: res.shortcuts, created: new Date(res.created * 1000) };
};

/** Reloads every window so restored settings and credentials take effect everywhere. */
export const reloadAfterRestore = (): Promise<void> => invoke('backup_reload_windows');
