import { useEffect, useRef, useState } from 'react';

/** Counts from the last rendered value to `value` over `duration` ms via rAF. */
export function useAnimatedScore(value: number, duration = 600): number {
  const [displayed, setDisplayed] = useState(value);
  const displayedRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (value === displayedRef.current) return;

    const from = displayedRef.current;
    const to = value;
    let startTime: number | undefined;

    const tick = (now: number) => {
      if (startTime === undefined) startTime = now;
      const progress = Math.min(1, (now - startTime) / duration);
      const next = Math.round(from + (to - from) * progress);
      setDisplayed(next);
      displayedRef.current = next;
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplayed(to);
        displayedRef.current = to;
        rafRef.current = null;
      }
    };

    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [value, duration]);

  return displayed;
}
