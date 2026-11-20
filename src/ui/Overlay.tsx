import { Camera, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { hideCurrentWindow } from '../platform/window';
import { useDeviceStore } from '../state/deviceStore';
import { useLayoutStore, withName } from '../state/layoutStore';
import { useViewStore } from '../state/viewStore';
import { EntityCard } from './EntityCard';
import { FullscreenCamera } from './FullscreenCamera';
import { OverlayGroups } from './overlay/OverlayGroups';
import { OverlayGroupsEditor } from './overlay/OverlayGroupsEditor';
import { PipLayer } from './PipLayer';
import { VoiceOverlay } from './voice/VoiceOverlay';
import { TimerTray } from './timers/TimerTray';

/** Domains worth one-tap access from the floating overlay. */
const QUICK_DOMAINS = new Set(['light', 'switch', 'lock', 'cover', 'media_player', 'climate']);

/**
 * Compact always-on-top panel summoned by the global shortcut. Shows the user's
 * overlay groups, or (until any exist) all cameras plus quick controls. Esc or
 * the X hides it back to tray (streams pause before the native hide).
 */
export function Overlay() {
  const groups = useLayoutStore((s) => s.overlayGroups);
  const fullscreenUid = useViewStore((s) => s.fullscreenUid);
  const [editorOpen, setEditorOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && fullscreenUid === null && !editorOpen) void hideCurrentWindow();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreenUid, editorOpen]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface/95 shadow-2xl backdrop-blur-xl">
      <header data-tauri-drag-region className="flex cursor-move items-center gap-2 border-b border-line px-4 py-2.5">
        <span data-tauri-drag-region className="text-sm font-semibold">Smart Home</span>
        <span data-tauri-drag-region className="text-xs text-slate-500">Esc to hide</span>
        <button
          type="button"
          onClick={() => setEditorOpen(true)}
          aria-label="Choose what the overlay shows"
          title="Choose what the overlay shows"
          className="ml-auto rounded-md p-1 text-slate-400 hover:bg-panel-hi hover:text-slate-100"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => void hideCurrentWindow()}
          aria-label="Hide overlay"
          className="rounded-md p-1 text-slate-400 hover:bg-panel-hi hover:text-slate-100"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">{groups === null ? <DefaultOverlay /> : <OverlayGroups groups={groups} />}</div>

      {editorOpen && <OverlayGroupsEditor onClose={() => setEditorOpen(false)} />}
      <PipLayer />
      <FullscreenCamera />
      <VoiceOverlay />
      <TimerTray compact />
    </div>
  );
}

/** Built-in overlay: every camera as a popup toggle, plus quick controls. */
function DefaultOverlay() {
  const rawCameras = useDeviceStore((s) => s.cameras);
  const entities = useDeviceStore((s) => s.entities);
  const names = useLayoutStore((s) => s.names);
  const pips = useViewStore((s) => s.pips);
  const { openPip, closePip } = useViewStore.getState();
  const cameras = useMemo(() => rawCameras.map((c) => withName(c, names)), [rawCameras, names]);
  const quick = useMemo(() => entities.filter((e) => QUICK_DOMAINS.has(e.domain) && !e.secondary).map((e) => withName(e, names)), [entities, names]);
  const popped = useMemo(() => new Set(pips.map((p) => p.uid)), [pips]);

  return (
    <>
      <section aria-label="Cameras">
        <div className="flex flex-wrap gap-2">
          {cameras.map((c) => {
            const open = popped.has(c.uid);
            return (
              <button
                key={c.uid}
                type="button"
                aria-pressed={open}
                onClick={() => (open ? closePip(c.uid) : openPip(c.uid))}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${open ? 'border-accent bg-accent/20 text-white' : 'border-line bg-panel text-slate-300 hover:bg-panel-hi'} ${c.online ? '' : 'opacity-50'}`}
              >
                <Camera className="h-3.5 w-3.5" aria-hidden />
                {c.name}
              </button>
            );
          })}
        </div>
      </section>

      <section aria-label="Quick controls" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {quick.map((e) => (
          <EntityCard key={e.uid} entity={e} compact />
        ))}
      </section>
    </>
  );
}
