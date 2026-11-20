import { KeyRound, Loader2, Mic, MicOff, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getVoiceSession } from '../../app/voice';
import { errorMessage } from '../../core/DeviceProvider';
import { hasSecret } from '../../platform/secrets';
import { setVoice, useVoiceStore, type VoiceStatus } from '../../state/voiceStore';
import { GeminiKeyForm } from './GeminiKeyForm';
import { useShortcutStore } from '../../state/shortcutStore';
import { usePushToTalk } from './usePushToTalk';
import { markWakeSession, useSingleVoiceSession, useWakeAutoEnd } from './useVoiceOwnership';
import { useWakeEvent } from './useWakeWord';
import { Waveform } from './Waveform';

const STATUS_LABEL: Record<VoiceStatus, string> = {
  off: 'Voice off',
  connecting: 'Connecting…',
  ready: 'Hold {ptt} to talk',
  listening: 'Listening…',
  thinking: 'Working on it…',
  speaking: 'Speaking',
  error: 'Voice error',
};

/**
 * Floating voice pill: a mic "wake" button that toggles hands-free mode, plus
 * the waveform, live transcript and last action while a session is active.
 * Push-to-talk (hold) works from the keyboard and the global Tauri shortcut.
 */
export function VoiceOverlay() {
  const session = getVoiceSession();
  usePushToTalk(session);
  const pttLabel = useShortcutStore((s) => s.ptt);
  const status = useVoiceStore((s) => s.status);
  const visible = useVoiceStore((s) => s.visible);
  const micMode = useVoiceStore((s) => s.micMode);
  const userText = useVoiceStore((s) => s.userText);
  const modelText = useVoiceStore((s) => s.modelText);
  const lastAction = useVoiceStore((s) => s.lastAction);
  const error = useVoiceStore((s) => s.error);
  const needsKey = useVoiceStore((s) => s.needsKey);
  const [editingKey, setEditingKey] = useState(false);
  // "Hey Jarvis" → hands-free, same as clicking the mic.
  useWakeEvent(() => {
    if (!session) return;
    if (needsKey) return setEditingKey(true);
    markWakeSession();
    void session.beginTalk('handsfree');
  });
  useSingleVoiceSession(session);
  useWakeAutoEnd(session);

  useEffect(() => {
    if (!session) return;
    hasSecret('gemini_api_key').then(
      (has) => setVoice({ needsKey: !has }),
      (err: unknown) => setVoice({ error: errorMessage(err) }),
    );
  }, [session]);

  const handsFree = micMode === 'handsfree';
  const live = status === 'listening' || status === 'speaking';
  const transcript = modelText || userText;

  if (editingKey) {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
        <GeminiKeyForm onDone={() => setEditingKey(false)} />
      </div>
    );
  }

  const wakeButton = (
    <button
      type="button"
      disabled={!session}
      onClick={() => (needsKey ? setEditingKey(true) : void session?.toggleHandsFree())}
      aria-pressed={handsFree}
      aria-label={needsKey ? 'Add Gemini API key' : handsFree ? 'Stop hands-free voice' : 'Start hands-free voice'}
      title={
        !session
          ? 'Voice requires the desktop app'
          : needsKey
            ? 'Add your Gemini API key to enable voice'
            : `Say "Hey Jarvis" or click for hands-free, or hold ${pttLabel}`
      }
      className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        handsFree || status === 'listening' ? 'bg-accent text-white' : 'bg-panel-hi text-slate-200 hover:bg-line'
      }`}
    >
      {live && <span className="absolute inset-0 animate-ping rounded-full bg-accent/30 motion-reduce:hidden" aria-hidden />}
      {status === 'connecting' ? (
        <Loader2 className="h-4.5 w-4.5 animate-spin" aria-hidden />
      ) : session && needsKey ? (
        <KeyRound className="h-4.5 w-4.5" aria-hidden />
      ) : session ? (
        <Mic className="h-4.5 w-4.5" aria-hidden />
      ) : (
        <MicOff className="h-4.5 w-4.5" aria-hidden />
      )}
    </button>
  );

  if (!visible) {
    return (
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60]">
        <div className="pointer-events-auto rounded-full border border-line bg-surface/90 p-1 shadow-xl backdrop-blur-xl">
          {wakeButton}
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-full border border-line bg-surface/90 py-1.5 pl-1.5 pr-3 shadow-2xl ring-1 ring-black/40 backdrop-blur-xl"
      >
        {wakeButton}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Waveform status={status} width={120} height={22} />
            <span className={`truncate text-xs ${error ? 'text-bad' : 'text-slate-400'}`}>
              {error ?? STATUS_LABEL[status].replace('{ptt}', pttLabel)}
            </span>
          </div>
          <p className="truncate text-sm text-slate-100" title={transcript}>
            {transcript || (lastAction ? <span className="text-slate-400">{lastAction}</span> : ' ')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void session?.shutdown(true)}
          aria-label="End voice session"
          className="shrink-0 rounded-full p-1.5 text-slate-400 hover:bg-panel-hi hover:text-slate-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
