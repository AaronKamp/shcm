import { GripHorizontal } from 'lucide-react';
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useDeviceStore } from '../state/deviceStore';
import { PIP_MIN_WIDTH, useViewStore, type PipWindow } from '../state/viewStore';
import { UnifiVideoTile } from './video/UnifiVideoTile';

const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), Math.max(min, max));

/** Floating, draggable, resizable camera popups (16:9). Rendered above any view. */
export function PipLayer() {
  const pips = useViewStore((s) => s.pips);
  if (pips.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-40" aria-label="Camera popups">
      {pips.map((p) => (
        <PipPopup key={p.uid} pip={p} />
      ))}
    </div>
  );
}

function PipPopup({ pip }: { pip: PipWindow }) {
  const camera = useDeviceStore((s) => s.cameras.find((c) => c.uid === pip.uid));
  const { movePip, resizePip, focusPip, closePip, setFullscreen } = useViewStore.getState();
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const resize = useRef<{ startX: number; startW: number } | null>(null);
  const height = (pip.width * 9) / 16;

  if (!camera) return null;

  const onDragStart = (e: ReactPointerEvent<HTMLDivElement>): void => {
    focusPip(pip.uid);
    drag.current = { dx: e.clientX - pip.x, dy: e.clientY - pip.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    const x = clamp(e.clientX - drag.current.dx, 0, window.innerWidth - pip.width);
    const y = clamp(e.clientY - drag.current.dy, 0, window.innerHeight - height);
    movePip(pip.uid, x, y);
  };
  const onResizeStart = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    focusPip(pip.uid);
    resize.current = { startX: e.clientX, startW: pip.width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onResizeMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!resize.current) return;
    const maxW = Math.min(window.innerWidth - pip.x, ((window.innerHeight - pip.y) * 16) / 9);
    resizePip(pip.uid, clamp(resize.current.startW + e.clientX - resize.current.startX, PIP_MIN_WIDTH, maxW));
  };

  return (
    <div
      className="pointer-events-auto absolute touch-none select-none overflow-hidden rounded-xl shadow-2xl shadow-black/60 ring-1 ring-white/10"
      style={{ left: pip.x, top: pip.y, width: pip.width, height, zIndex: pip.z }}
      onPointerDown={onDragStart}
      onPointerMove={onDragMove}
      onPointerUp={() => (drag.current = null)}
      onDoubleClick={() => {
        closePip(pip.uid);
        setFullscreen(pip.uid);
      }}
      role="dialog"
      aria-label={`${camera.name} popup`}
      data-testid={`pip-${camera.slug}`}
    >
      <UnifiVideoTile
        camera={camera}
        variant="pip"
        headerSlot={<GripHorizontal className="h-4 w-4 cursor-move text-slate-300" aria-hidden />}
        onFullscreen={() => {
          closePip(pip.uid);
          setFullscreen(pip.uid);
        }}
        onClose={() => closePip(pip.uid)}
      />
      <div
        className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize"
        style={{ background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.35) 50%)' }}
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={() => (resize.current = null)}
        aria-hidden
      />
    </div>
  );
}
