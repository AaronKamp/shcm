import { Music } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { SmartEntity } from '../../core/types';
import { useMediaAppStore } from '../../state/mediaAppStore';
import { MediaAppsEditor } from './MediaAppsEditor';

/** Edit-mode badge on a speaker card that opens its music-app links. */
export function MediaAppsButton({ speaker }: { speaker: SmartEntity }) {
  const [open, setOpen] = useState(false);
  const linked = useMediaAppStore((s) => s.links[speaker.uid] !== undefined);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Music apps for ${speaker.name}`}
        title="Link Spotify / Music Assistant to this speaker"
        className={`absolute -top-1.5 right-6 flex items-center gap-1 rounded-md px-1 py-0.5 text-[10px] font-medium ring-1 ${linked ? 'bg-accent text-white ring-accent' : 'bg-black/70 text-slate-200 ring-white/20 hover:bg-black/90'}`}
      >
        <Music className="h-3 w-3" aria-hidden /> Apps
      </button>
      {open && createPortal(<MediaAppsEditor speaker={speaker} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}
