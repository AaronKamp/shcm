import { useEffect, useState } from 'react';

/** Current time, re-rendered on each new minute (plus a light check so sleep/resume catches up). */
export const useNow = (): Date => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = (): void => {
      const d = new Date();
      setNow(d);
      // Wake just after the next minute boundary, at most 15s from now.
      timer = setTimeout(tick, Math.min(15_000, 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50));
    };
    tick();
    return () => clearTimeout(timer);
  }, []);
  return now;
};
