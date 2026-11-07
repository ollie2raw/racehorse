import { useCallback, useEffect, useState } from 'react';

/**
 * How long on the post-game screen before the server's review job is requested anyway: none. The device's quick review already makes the game
 * readable at once, and the server's deeper analysis is the upgrade, so it starts at game over (docs/postgame-review-plan.md, phases 2 and 3).
 */
export const REVIEW_START_DELAY_MS = 0;

/**
 * Review start. Reviews cost server CPU (8-97 s per game measured), so a
 * delay is supported (`delayMs`): the job is requested when the player opens
 * a review, or after `delayMs` on the post-game screen, whichever comes
 * first. The default delay is now zero (see REVIEW_START_DELAY_MS). Resets
 * when `active` goes false (the next game).
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
