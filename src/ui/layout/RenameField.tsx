import { Check, RotateCcw, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';

interface Props {
  readonly value: string;
  readonly defaultName: string;
  /** Blank or equal to `defaultName` means "use the provider's name". */
  readonly onSave: (name: string) => void;
  readonly onCancel: () => void;
}

const iconBtn = 'shrink-0 rounded-md p-1 text-slate-300 hover:bg-panel-hi hover:text-white';

/** Inline name editor shown over a tile. Enter saves, Esc cancels. */
export function RenameField({ value, defaultName, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState(value);
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    onSave(draft.trim() || defaultName);
  };

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
      className="absolute inset-x-1 top-1 z-30 flex items-center gap-1 rounded-lg border border-accent bg-surface p-1 shadow-xl"
    >
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        placeholder={defaultName}
        aria-label="Name"
        className="min-w-0 flex-1 bg-transparent px-1.5 py-0.5 text-sm text-slate-100 outline-none"
      />
      {value !== defaultName && (
        <button type="button" className={iconBtn} onClick={() => onSave(defaultName)} title={`Reset to “${defaultName}”`} aria-label="Reset name">
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
      <button type="submit" className={iconBtn} aria-label="Save name">
        <Check className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={iconBtn} onClick={onCancel} aria-label="Cancel">
        <X className="h-3.5 w-3.5" />
      </button>
    </form>
  );
}
