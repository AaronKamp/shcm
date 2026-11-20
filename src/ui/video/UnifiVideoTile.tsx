import { Maximize2, Minimize2, PictureInPicture2, VideoOff, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import type { CameraStream } from '../../core/types';
import { useAppVisible } from '../../state/viewStore';
import { TestPatternCanvas } from './TestPatternCanvas';
import { useInView } from './useInView';
import { useStreamPlayer, type PlayerStatus } from './useStreamPlayer';

export type TileVariant = 'grid' | 'pip' | 'fullscreen';

interface Props {
  readonly camera: CameraStream;
  readonly variant?: TileVariant;
  readonly onPip?: () => void;
  readonly onFullscreen?: () => void;
  readonly onExitFullscreen?: () => void;
  readonly onClose?: () => void;
  /** Extra header content (e.g. drag handle in PiP). */
  readonly headerSlot?: ReactNode;
  /** Force-release the stream (e.g. grid tile covered by fullscreen, or shown in a PiP). */
  readonly suspended?: boolean;
  /** Grid tile shape; the video is cropped to fill it. Default 16:9. */
  readonly aspect?: string;
}

const STATUS_LABEL: Record<PlayerStatus, string> = {
  idle: 'Idle',
  connecting: 'Connecting',
  playing: 'Live',
  paused: 'Paused',
  offline: 'Offline',
  error: 'Error',
};

const STATUS_DOT: Record<PlayerStatus, string> = {
  idle: 'bg-slate-500',
  connecting: 'bg-warn animate-pulse',
  playing: 'bg-ok',
  paused: 'bg-slate-500',
  offline: 'bg-bad',
  error: 'bg-bad',
};

/**
 * Low-latency camera tile. Plays WHEP/WebRTC (go2rtc) with zero jitter buffer,
 * falls back through the camera's stream list, and fully tears down media when
 * the app is hidden to tray, minimized, or the tile scrolls offscreen.
 */
export function UnifiVideoTile({ camera, variant = 'grid', onPip, onFullscreen, onExitFullscreen, onClose, headerSlot, suspended = false, aspect = 'aspect-video' }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const appVisible = useAppVisible();
  const inView = useInView(rootRef);
  const active = appVisible && !suspended && (variant !== 'grid' || inView);
  const player = useStreamPlayer(camera.streams, active, camera.online, camera.streamError);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (player.media) {
      video.srcObject = player.media;
      video.play().catch(() => undefined);
      return;
    }
    // Detaching srcObject releases the hardware decoder.
    video.pause();
    video.srcObject = null;
    // H.265 via go2rtc MSE: the session feeds fMP4 into this element.
    return player.mse?.attach(video);
  }, [player.media, player.mse]);

  const src = player.source;
  const showVideo = src?.protocol === 'webrtc';
  const recentMotion = camera.lastMotion !== undefined && Date.now() - camera.lastMotion < 30_000;
  const rounded = variant === 'fullscreen' ? '' : 'rounded-xl';

  return (
    <div
      ref={rootRef}
      className={`group relative overflow-hidden bg-black ${rounded} ${variant === 'grid' ? `${aspect} border border-line` : 'h-full w-full'} ${recentMotion ? 'ring-2 ring-warn' : ''}`}
      data-tile
      data-testid={`video-tile-${camera.slug}`}
      data-player-status={player.status}
    >
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        disablePictureInPicture
        className={`h-full w-full object-cover ${showVideo ? '' : 'hidden'}`}
      />
      {src?.protocol === 'test_pattern' && <TestPatternCanvas label={camera.name} running={player.status === 'playing'} />}
      {src?.protocol === 'mjpeg' && player.status === 'playing' && (
        <img src={src.url} alt={camera.name} className="h-full w-full object-cover" />
      )}

      {player.status !== 'playing' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-panel/90 text-sm text-slate-400">
          <VideoOff className="h-6 w-6" aria-hidden />
          <span>{player.status === 'paused' ? (suspended ? 'Playing elsewhere' : 'Paused (hidden)') : STATUS_LABEL[player.status]}</span>
          {player.error && player.status === 'error' && <span className="max-w-[80%] truncate text-xs text-slate-500">{player.error}</span>}
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent px-3 py-2 text-xs">
        <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[player.status]}`} aria-hidden />
        <span className="truncate font-medium text-white">{camera.name}</span>
        <span className="text-slate-300">{STATUS_LABEL[player.status]}</span>
        {src && player.status === 'playing' && <span className="rounded bg-white/10 px-1.5 py-0.5 uppercase text-slate-300">{src.protocol === 'test_pattern' ? 'mock' : player.mse ? (player.mse.mime.includes('hvc1') ? 'mse · h.265' : 'mse') : src.protocol}</span>}
        <div className="pointer-events-auto ml-auto flex items-center gap-1">
          {headerSlot}
          {onPip && <TileButton label="Pop out" onClick={onPip}><PictureInPicture2 className="h-4 w-4" /></TileButton>}
          {onFullscreen && <TileButton label="Fullscreen" onClick={onFullscreen}><Maximize2 className="h-4 w-4" /></TileButton>}
          {onExitFullscreen && <TileButton label="Exit fullscreen" onClick={onExitFullscreen}><Minimize2 className="h-4 w-4" /></TileButton>}
          {onClose && <TileButton label="Close" onClick={onClose}><X className="h-4 w-4" /></TileButton>}
        </div>
      </div>
    </div>
  );
}

function TileButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="rounded-md p-1 text-slate-200 hover:bg-white/15"
    >
      {children}
    </button>
  );
}
