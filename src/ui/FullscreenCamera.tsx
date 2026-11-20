import { useEffect } from 'react';
import { useDeviceStore } from '../state/deviceStore';
import { useViewStore } from '../state/viewStore';
import { UnifiVideoTile } from './video/UnifiVideoTile';

/** Full-window camera view. Esc or the minimize button returns to the grid. */
export function FullscreenCamera() {
  const uid = useViewStore((s) => s.fullscreenUid);
  const camera = useDeviceStore((s) => (uid ? s.cameras.find((c) => c.uid === uid) : undefined));
  const { setFullscreen, openPip } = useViewStore.getState();

  useEffect(() => {
    if (!uid) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setFullscreen(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [uid, setFullscreen]);

  if (!uid || !camera) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black" role="dialog" aria-label={`${camera.name} fullscreen`}>
      <UnifiVideoTile
        camera={camera}
        variant="fullscreen"
        onPip={() => {
          setFullscreen(null);
          openPip(camera.uid);
        }}
        onExitFullscreen={() => setFullscreen(null)}
      />
    </div>
  );
}
