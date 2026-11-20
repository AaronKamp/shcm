import { useEffect, useRef } from 'react';
import type { VoiceStatus } from '../../state/voiceStore';
import { LEVEL_HISTORY, micLevels, speakerLevels } from '../../voice/levels';

interface Props {
  readonly status: VoiceStatus;
  readonly width?: number;
  readonly height?: number;
}

const BAR_GAP = 2;

const colorFor = (status: VoiceStatus): string => {
  const css = getComputedStyle(document.documentElement);
  const pick = (v: string, fallback: string): string => css.getPropertyValue(v).trim() || fallback;
  if (status === 'speaking') return pick('--color-voice-model', '#a78bfa');
  if (status === 'listening') return pick('--color-accent', '#f7841f');
  if (status === 'error') return pick('--color-bad', '#f2555a');
  return '#64748b';
};

/**
 * Mirrored bar waveform painted on a canvas from the level meters. Runs its own
 * rAF loop and never touches React state, so 60fps audio visuals cost no renders.
 */
export function Waveform({ status, width = 168, height = 36 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.scale(dpr, dpr);

    const levels = new Float32Array(LEVEL_HISTORY);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const barW = (width - BAR_GAP * (LEVEL_HISTORY - 1)) / LEVEL_HISTORY;
    let color = colorFor(statusRef.current);
    let lastStatus = statusRef.current;
    let raf = 0;

    const draw = (t: number): void => {
      const s = statusRef.current;
      if (s !== lastStatus) {
        lastStatus = s;
        color = colorFor(s);
      }
      if (s === 'speaking') speakerLevels.read(levels);
      else if (s === 'listening') micLevels.read(levels);
      else {
        // Idle "breathing" line while connecting / thinking / ready.
        const busy = s === 'connecting' || s === 'thinking';
        for (let i = 0; i < LEVEL_HISTORY; i++) {
          levels[i] = reduceMotion ? 0.05 : 0.04 + (busy ? 0.12 : 0.03) * (0.5 + 0.5 * Math.sin(t / 220 - i * 0.35));
        }
      }
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = color;
      const mid = height / 2;
      for (let i = 0; i < LEVEL_HISTORY; i++) {
        // Taper the edges so the shape reads as a voice, not a bar chart.
        const taper = Math.sin((Math.PI * (i + 0.5)) / LEVEL_HISTORY);
        const h = Math.max(2, (levels[i] ?? 0) * taper * (height - 2));
        const x = i * (barW + BAR_GAP);
        ctx.globalAlpha = 0.45 + 0.55 * taper;
        ctx.beginPath();
        ctx.roundRect(x, mid - h / 2, barW, h, barW / 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height]);

  return <canvas ref={ref} style={{ width, height }} aria-hidden className="block" />;
}
