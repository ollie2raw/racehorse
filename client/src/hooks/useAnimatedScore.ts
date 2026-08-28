import { useEffect, useRef, useState } from 'react';

/**
 * Counts from the last rendered value to `value` over `duration` ms via rAF.
 *
 * By default the first render *is* `value`, so a HUD that mounts mid-match
 * shows the real score rather than counting up to it. Pass `from` when the
 * count-up itself is the point — a results screen mounts already knowing its
 * final number, and without a start value there would be nothing to animate.
 * `from` is read once, on mount; later changes to it are ignored so the number
 * never restarts from the bottom.
 *
 * The rAF handle is cancelled on unmount, so a results modal dismissed
 * mid-count leaves nothing running.
 */
export function useAnimatedScore(value: number, duration = 600, from?: number): number {
  const initial = from ?? value;
  const [displayed, setDisplayed] = useState(initial);
  const displayedRef = useRef(initial);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (value === displayedRef.current) return;

    const start = displayedRef.current;
    const to = value;
    let startTime: number | undefined;

    const tick = (now: number) => {
      if (startTime === undefined) startTime = now;
      const progress = Math.min(1, (now - startTime) / duration);
      const next = Math.round(start + (to - start) * progress);
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
