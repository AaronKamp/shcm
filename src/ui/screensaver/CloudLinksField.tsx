import { AlertCircle, CheckCircle2, Link2, Loader2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { detectService, SERVICE_LABEL, type LinkStatus } from '../../platform/photos';
import { updateScreensaver } from '../../state/screensaverStore';

interface Props {
  readonly links: readonly string[];
  /** From the latest scan; null while scanning. */
  readonly statuses: readonly LinkStatus[] | null;
}

/** Share links shown without the key part, so the list stays readable. */
const shortLink = (link: string): string => {
  try {
    const u = new URL(link);
    const path = u.pathname.length > 24 ? `${u.pathname.slice(0, 22)}…` : u.pathname;
    return `${u.hostname.replace(/^www\./, '')}${path}`;
  } catch {
    return link;
  }
};

/**
 * Public share links to cloud albums, read directly (no sync app or sign-in).
 * Each shows its service and how many photos it has, or why it failed.
 */
export function CloudLinksField({ links, statuses }: Props) {
  const [draft, setDraft] = useState('');
  const service = detectService(draft);

  const add = (e: FormEvent): void => {
    e.preventDefault();
    const link = draft.trim();
    if (!service || links.includes(link)) return;
    updateScreensaver({ links: [...links, link] });
    setDraft('');
  };

  return (
    <div className="mt-3">
      <p className="mb-1 text-xs text-slate-300">Shared albums</p>
      {links.length > 0 && (
        <ul className="mb-2 space-y-1">
          {links.map((link) => {
            const st = statuses?.find((s) => s.link === link);
            const kind = detectService(link);
            return (
              <li key={link} className="flex items-center gap-2 text-xs text-slate-200">
                {!statuses ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-500" aria-label="Checking" />
                ) : st?.error ? (
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-bad" aria-label="Failed" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-ok" aria-label="OK" />
                )}
                <span className="shrink-0 font-medium">{kind ? SERVICE_LABEL[kind] : 'Link'}</span>
                <span className="min-w-0 flex-1 truncate text-slate-500" title={st?.error ?? undefined}>
                  {st?.error ? <span className="text-bad">{st.error}</span> : st ? `${st.count.toLocaleString()} photos · ${shortLink(link)}` : shortLink(link)}
                </span>
                <button
                  type="button"
                  onClick={() => updateScreensaver({ links: links.filter((l) => l !== link) })}
                  aria-label={`Remove ${kind ? SERVICE_LABEL[kind] : ''} album`}
                  className="rounded p-0.5 text-slate-500 hover:bg-panel-hi hover:text-slate-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <form onSubmit={add} className="flex items-center gap-2">
        <span className="relative min-w-0 flex-1">
          <Link2 className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" aria-hidden />
          <input
            type="url"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Paste a Google Photos, Amazon Photos or OneDrive share link"
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded-lg border border-line bg-surface py-1 pl-7 pr-2 text-xs text-slate-100 outline-none focus:border-accent"
          />
        </span>
        <button type="submit" disabled={!service} className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
          {service ? `Add ${SERVICE_LABEL[service]}` : 'Add'}
        </button>
      </form>
      <p className="mt-1.5 text-xs text-slate-500">
        In the app or website, share the album with “Anyone with the link” and copy the link. These services don’t officially support reading links, so a link can
        stop working if they change their sites. Photos are cached on this PC.
      </p>
    </div>
  );
}
