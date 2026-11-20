import { useEffect, useState, type ReactNode } from 'react';
import { resolveImage } from '../../platform/haImage';

interface Props {
  /** Image sources in priority order; the first that loads is shown. */
  readonly sources: readonly string[];
  readonly className: string;
  /** Shown when none load (or there are none). */
  readonly fallback: ReactNode;
  /** Reports which source index is showing (-1 = fallback). */
  readonly onShown?: (index: number) => void;
}

/**
 * Tries each source in order: HA-relative paths are resolved through the
 * backend, and an image that fails to load moves on to the next one.
 */
export function FallbackImage({ sources, className, fallback, onShown }: Props) {
  const key = sources.join('\n');
  const [index, setIndex] = useState(0);
  const [src, setSrc] = useState<string | null>(null);

  // A new candidate list starts from the top.
  useEffect(() => setIndex(0), [key]);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    const candidate = sources[index];
    if (candidate === undefined) {
      onShown?.(-1);
      return;
    }
    resolveImage(candidate)
      .then((url) => !cancelled && setSrc(url))
      .catch(() => !cancelled && setIndex((i) => i + 1));
    return () => {
      cancelled = true;
    };
    // `sources` is captured via `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, index]);

  if (!src) return <>{index >= sources.length ? fallback : <span className={`${className} animate-pulse bg-panel-hi`} aria-hidden />}</>;
  return (
    <img
      src={src}
      alt=""
      className={className}
      onLoad={() => onShown?.(index)}
      onError={() => setIndex((i) => i + 1)}
    />
  );
}
