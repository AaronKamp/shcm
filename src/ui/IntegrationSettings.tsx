import { CheckCircle2, Circle, X } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { errorMessage } from '../core/DeviceProvider';
import { emitCredentialsUpdated, hasSecret, setSecret, type SecretKind } from '../platform/secrets';
import { ScreensaverSettings } from './screensaver/ScreensaverSettings';
import { ShortcutSettings } from './ShortcutSettings';
import { WakeWordSettings } from './WakeWordSettings';

interface Field {
  readonly kind: SecretKind;
  readonly label: string;
  readonly placeholder: string;
  readonly secret: boolean;
}

interface Section {
  readonly title: string;
  readonly note?: string;
  /** Saved in order: URL before credential (a URL change wipes the credential). */
  readonly fields: readonly Field[];
}

const SECTIONS: readonly Section[] = [
  {
    title: 'Home Assistant',
    note: 'Connects through the local relay; the token never reaches this window.',
    fields: [
      { kind: 'home_assistant_url', label: 'URL', placeholder: 'http://homeassistant.local:8123', secret: false },
      { kind: 'home_assistant_token', label: 'Long-lived access token', placeholder: '', secret: true },
    ],
  },
  {
    title: 'UniFi Protect',
    note: "Paste the address you open Protect at (e.g. http://192.168.1.1/protect); the app always connects over HTTPS. The console's certificate is pinned on first connect; saving a different console resets the pin.",
    fields: [
      { kind: 'unifi_url', label: 'Console URL', placeholder: 'http://192.168.1.1/protect', secret: false },
      { kind: 'unifi_api_key', label: 'Integration API key', placeholder: '', secret: true },
    ],
  },
  {
    title: 'Video bridge (go2rtc)',
    note: 'Webviews can’t play RTSPS. UniFi streams are registered with go2rtc and played over WebRTC. Must be a local or LAN address, e.g. the go2rtc add-on on port 1984.',
    fields: [{ kind: 'go2rtc_url', label: 'go2rtc URL', placeholder: 'http://homeassistant.local:1984', secret: false }],
  },
  {
    title: 'Gemini voice',
    fields: [{ kind: 'gemini_api_key', label: 'API key', placeholder: '', secret: true }],
  },
];

const ALL_KINDS = SECTIONS.flatMap((s) => s.fields.map((f) => f.kind));

interface Props {
  readonly onClose: () => void;
}

/**
 * Write-only credential editor. Values go straight to the OS credential store via
 * `set_secret` and are cleared from component state; only "saved" status is read back.
 */
export function IntegrationSettings({ onClose }: Props) {
  const [stored, setStored] = useState<Partial<Record<SecretKind, boolean>>>({});
  const [draft, setDraft] = useState<Partial<Record<SecretKind, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const flags = await Promise.all(ALL_KINDS.map(async (k) => [k, await hasSecret(k)] as const));
    setStored(Object.fromEntries(flags));
  }, []);

  useEffect(() => {
    refresh().catch((err: unknown) => setError(errorMessage(err)));
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [refresh, onClose]);

  const save = async (e: FormEvent, section: Section): Promise<void> => {
    e.preventDefault();
    setBusy(section.title);
    setError(null);
    const saved: SecretKind[] = [];
    try {
      for (const f of section.fields) {
        const value = draft[f.kind];
        if (!value?.trim()) continue;
        await setSecret(f.kind, value);
        saved.push(f.kind);
      }
      setDraft((d) => {
        const next = { ...d };
        for (const f of section.fields) delete next[f.kind];
        return next;
      });
      setNotice(`${section.title} saved — reconnecting…`);
      await refresh();
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      // Even a partial save (URL saved, token failed) changed the store: let every window resync.
      await emitCredentialsUpdated(saved).catch((err: unknown) => setError(errorMessage(err)));
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4" role="dialog" aria-modal aria-label="Settings">
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl">
        <header className="mb-4 flex items-center">
          <h2 className="text-base font-semibold">Settings</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto rounded-md p-1 text-slate-400 hover:bg-panel-hi hover:text-slate-100">
            <X className="h-4 w-4" />
          </button>
        </header>
        <ShortcutSettings />
        <WakeWordSettings />
        <ScreensaverSettings onPreview={onClose} />
        <h3 className="mb-1 text-sm font-semibold text-slate-200">Integrations</h3>
        <p className="mb-4 text-xs text-slate-400">
          Stored in the system credential store. Values can't be viewed after saving — leave a field blank to keep it.
        </p>

        {SECTIONS.map((section) => (
          <form key={section.title} onSubmit={(e) => void save(e, section)} className="mb-4 rounded-xl border border-line bg-panel p-3">
            <h3 className="mb-1 text-sm font-medium">{section.title}</h3>
            {section.note && <p className="mb-2 text-xs text-slate-500">{section.note}</p>}
            {section.fields.map((f) => (
              <label key={f.kind} className="mb-2 block text-xs text-slate-300">
                <span className="mb-1 flex items-center gap-1.5">
                  {stored[f.kind] ? <CheckCircle2 className="h-3.5 w-3.5 text-ok" aria-label="saved" /> : <Circle className="h-3.5 w-3.5 text-slate-600" aria-label="not set" />}
                  {f.label}
                </span>
                <input
                  type={f.secret ? 'password' : 'url'}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={stored[f.kind] ? (f.secret ? '•••••••• (saved)' : 'saved — enter to replace') : f.placeholder}
                  value={draft[f.kind] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.kind]: e.target.value }))}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-accent"
                />
              </label>
            ))}
            <button
              type="submit"
              disabled={busy !== null || section.fields.every((f) => !draft[f.kind]?.trim())}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {busy === section.title ? 'Saving…' : 'Save'}
            </button>
          </form>
        ))}

        {error && <p className="mb-3 text-xs text-bad">{error}</p>}
        {notice && !error && (
          <p role="status" className="text-xs text-ok">
            {notice}
          </p>
        )}
      </div>
    </div>
  );
}
