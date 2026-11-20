import { KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../../core/DeviceProvider';
import { emitCredentialsUpdated, setSecret } from '../../platform/secrets';
import { setVoice } from '../../state/voiceStore';

interface Props {
  readonly onDone: () => void;
}

/**
 * One-time Gemini key entry. The value goes straight to the OS credential store
 * via `set_secret` and is dropped from component state; it can never be read back.
 */
export function GeminiKeyForm({ onDone }: Props) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await setSecret('gemini_api_key', value);
      setValue('');
      setVoice({ needsKey: false, error: null });
      // Lets the other window drop its "needs key" state too.
      await emitCredentialsUpdated(['gemini_api_key']);
      onDone();
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="pointer-events-auto flex w-full max-w-md flex-col gap-2 rounded-2xl border border-line bg-surface/95 p-3 shadow-2xl backdrop-blur-xl"
    >
      <label htmlFor="gemini-key" className="flex items-center gap-2 text-xs font-medium text-slate-300">
        <KeyRound className="h-3.5 w-3.5" aria-hidden /> Gemini API key
        <span className="font-normal text-slate-500">— saved to the system credential store</span>
      </label>
      <div className="flex gap-2">
        <input
          id="gemini-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Save
        </button>
        <button type="button" onClick={onDone} className="rounded-lg px-2 text-sm text-slate-400 hover:text-slate-100">
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
    </form>
  );
}
