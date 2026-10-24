import { useEffect, useRef, useState } from 'react';
import { motionDuration, useMotionAllowed } from '../ui/motion';

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
export function useAnimatedScore(value: number, duration: number = motionDuration.reward, from?: number): number {
  const motionAllowed = useMotionAllowed();
  const initial = motionAllowed ? (from ?? value) : value;
  const enabled = motionAllowed && duration > 0;
  const [presentation, setPresentation] = useState({ enabled, value: initial });
  // Reset the displayed snapshot during render when animation is disabled or
  // re-enabled, so a preference/tab change never flashes an old score.
  if (presentation.enabled !== enabled || (!enabled && presentation.value !== value)) {
    setPresentation({ enabled, value });
  }
  const displayedRef = useRef(initial);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      displayedRef.current = value;
      return;
    }
    if (value === displayedRef.current) return;

    const start = displayedRef.current;
    const to = value;
    let startTime: number | undefined;

    const tick = (now: number) => {
      if (startTime === undefined) startTime = now;
      const progress = Math.min(1, (now - startTime) / duration);
      const next = Math.round(start + (to - start) * progress);
      setPresentation({ enabled: true, value: next });
      displayedRef.current = next;
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setPresentation({ enabled: true, value: to });
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
  }, [value, duration, enabled]);

  return enabled ? presentation.value : value;
}
