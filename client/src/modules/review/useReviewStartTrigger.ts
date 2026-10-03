import { useCallback, useEffect, useState } from 'react';

/** Seconds on the post-game screen before a review job is requested anyway. */
export const REVIEW_START_DELAY_MS = 5_000;

/**
 * On-demand review start. Reviews cost server CPU (8-97 s per game measured),
 * and a result is only shown while the post-game screen is open, so a job
 * requested for a player who leaves straight away is pure waste. The job is
 * requested when the player opens a review, or after `delayMs` on the
 * post-game screen, whichever comes first. Resets when `active` goes false
 * (the next game).
 */
export function useReviewStartTrigger({ active, delayMs }: { active: boolean; delayMs: number }) {
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!active) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset for the next game when the post-game screen goes away
      setStarted(false);
      return;
    }
    if (started) return;
    if (delayMs <= 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- zero delay: start immediately
      setStarted(true);
      return;
    }
    const timer = setTimeout(() => setStarted(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs, started]);

  const requestStart = useCallback(() => setStarted(true), []);
  return { started, requestStart };
}
