import { useEffect } from 'react';
import type { AppMode } from '../types';
import { abandonJourneyMatchAttempt } from './journeyMatchOutcome';
import { clearJourneyActiveChallenge, getJourneyActiveChallenge } from './journeyRuntime';

/**
 * A Journey challenge describes the match that is *currently* being played, so it can only be valid
 * while the app is in match mode (`'bot'`). The route that launches it sets it in the same handler that
 * switches to `'bot'`, and the match route reads it on every render.
 *
 * The explicit exits (Leave, Continue Trail, Return to Trail, nav) clear it themselves, but leaving by
 * browser history or a swipe runs none of those handlers — and an ordinary Play vs Fritz match started
 * afterwards would then inherit the stale challenge's tier, deal size, target score, rules and HUD.
 *
 * Keying on the app mode closes every such path at once: whenever the mode is anything but `'bot'`, no
 * live Journey match can exist, so any remembered challenge is dead and its attempt is abandoned (a no-op
 * if a win/loss was already recorded).
 *
 * Why not clear from an unmount cleanup: React's Strict Mode simulates unmount/remount of an effect, and
 * a cleanup here would clear a valid challenge in the middle of a match. This effect depends only on
 * `appMode`, so it does not run for rematches, re-renders or remounts while the mode stays `'bot'`, and
 * it does not run in the render between a launch setting the challenge and the mode becoming `'bot'`
 * (the mode has not changed yet).
 */
export function useClearJourneyChallengeOutsideMatch(appMode: AppMode): void {
  useEffect(() => {
    if (appMode === 'bot') return;
    const challenge = getJourneyActiveChallenge();
    if (!challenge) return;
    abandonJourneyMatchAttempt(challenge.attemptId);
    clearJourneyActiveChallenge();
  }, [appMode]);
}
