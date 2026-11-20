import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { inTauri } from '../../platform/window';
import { DEFAULT_TITLE, updateAppPrefs, useAppPrefsStore } from '../../state/appPrefsStore';

const MAX_LEN = 60;

/** Header name; click to rename. Enter or clicking away saves, Escape cancels, empty restores the default. */
export function AppTitle() {
  const title = useAppPrefsStore((s) => s.title);
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = title;
    if (inTauri()) void getCurrentWindow().setTitle(title).catch(() => undefined);
  }, [title]);

  const editing = draft !== null;
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const save = (e?: FormEvent): void => {
    e?.preventDefault();
    if (draft === null) return;
    updateAppPrefs({ title: draft.trim().slice(0, MAX_LEN) || DEFAULT_TITLE });
    setDraft(null);
  };

  if (draft === null) {
    return (
      <h1>
        <button
          type="button"
          onClick={() => setDraft(title)}
          title="Click to rename"
          className="-mx-1.5 rounded-md px-1.5 text-left text-lg font-semibold tracking-tight hover:bg-panel-hi"
        >
          {title}
        </button>
      </h1>
    );
  }
  return (
    <form onSubmit={save}>
      <input
        ref={input}
        value={draft}
        maxLength={MAX_LEN}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => save()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            setDraft(null);
          }
        }}
        aria-label="Dashboard name"
        placeholder={DEFAULT_TITLE}
        size={Math.max(12, draft.length + 1)}
        className="-mx-1.5 rounded-md border border-accent bg-surface px-1.5 text-lg font-semibold tracking-tight text-slate-100 outline-none"
      />
    </form>
  );
}
