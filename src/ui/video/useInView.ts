import { useEffect, useState, type RefObject } from 'react';

/** True while the element intersects the viewport; offscreen tiles release their streams. */
export const useInView = (ref: RefObject<Element | null>, rootMargin = '120px'): boolean => {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setInView(entry.isIntersecting);
    }, { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin]);
  return inView;
};
