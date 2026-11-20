import { useEffect, useRef } from 'react';

interface Props {
  readonly label: string;
  /** When false the animation loop is fully stopped (no rAF, no paint). */
  readonly running: boolean;
  readonly onFirstFrame?: () => void;
}

const BARS = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];

/**
 * Renders the synthetic `test_pattern` protocol from MockDeviceProvider:
 * SMPTE-style bars, a moving sweep and a running clock, at ~15fps to stay cheap.
 */
export function TestPatternCanvas({ label, running, onFirstFrame }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const firstFrame = useRef(onFirstFrame);
  firstFrame.current = onFirstFrame;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !running) return;

    let raf = 0;
    let last = 0;
    let painted = false;
    const draw = (t: number): void => {
      raf = requestAnimationFrame(draw);
      if (t - last < 66) return;
      last = t;
      const { width: w, height: h } = canvas;
      const barW = w / BARS.length;
      BARS.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect(i * barW, 0, barW + 1, h * 0.72);
      });
      ctx.fillStyle = '#101218';
      ctx.fillRect(0, h * 0.72, w, h * 0.28);
      const sweep = ((t / 4000) % 1) * w;
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(sweep, 0, w * 0.04, h * 0.72);
      ctx.fillStyle = '#e6e8ee';
      ctx.font = `600 ${Math.round(h * 0.07)}px "Segoe UI", sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillText(`TEST · ${label.toUpperCase()}`, w * 0.04, h * 0.86);
      const clock = new Date().toLocaleTimeString([], { hour12: false });
      const cw = ctx.measureText(clock).width;
      ctx.fillText(clock, w * 0.96 - cw, h * 0.86);
      if (!painted) {
        painted = true;
        firstFrame.current?.();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [label, running]);

  return <canvas ref={ref} width={640} height={360} className="h-full w-full object-cover" />;
}
