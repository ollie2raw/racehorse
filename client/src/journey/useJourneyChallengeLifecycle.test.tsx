// @vitest-environment jsdom
import { StrictMode } from 'react';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { getJourneyNodeById } from './journeyChapters';
import { loadJourneyAttempts } from './journeyAttempts';
import { buildJourneyBotTrial } from './journeyLaunch';
import { beginJourneyMatchAttempt, recordJourneyMatchOutcome } from './journeyMatchOutcome';
import { clearJourneyActiveChallenge, getJourneyActiveChallenge, setJourneyActiveChallenge } from './journeyRuntime';
import { markJourneyNodeCompleted } from './journeyStorage';
import { setJourneyStorageUser } from './journeyStorageScope';
import { useClearJourneyChallengeOutsideMatch } from './useJourneyChallengeLifecycle';
import type { AppMode } from '../types';

const DOT = 'ch1-n02';

function launchDot() {
  const node = getJourneyNodeById(DOT)!;
  const challenge = beginJourneyMatchAttempt(buildJourneyBotTrial({ ...node, status: 'unlocked' })!);
  setJourneyActiveChallenge(challenge);
  return challenge;
}

beforeEach(() => {
  window.localStorage.clear();
  setJourneyStorageUser(null);
  clearJourneyActiveChallenge();
  markJourneyNodeCompleted('ch1-n07');
});

describe('useClearJourneyChallengeOutsideMatch', () => {
  it('does nothing when there is no challenge', () => {
    renderHook(({ mode }: { mode: AppMode }) => useClearJourneyChallengeOutsideMatch(mode), { initialProps: { mode: 'home' as AppMode } });
    expect(getJourneyActiveChallenge()).toBeNull();
  });

  it('keeps the challenge for as long as the app stays in match mode — re-renders and rematches do not clear it', () => {
    const { rerender } = renderHook(({ mode }: { mode: AppMode }) => useClearJourneyChallengeOutsideMatch(mode), { initialProps: { mode: 'journey' as AppMode } });
    // The launch: challenge set while still on the trail, then the mode switches to 'bot' in the same event.
    const challenge = launchDot();
    expect(getJourneyActiveChallenge()).toEqual(challenge);
    rerender({ mode: 'bot' });
    for (let index = 0; index < 5; index += 1) rerender({ mode: 'bot' }); // rematch / remount churn
    expect(getJourneyActiveChallenge()).toEqual(challenge);
  });

  it('does not clear a challenge set on the trail before the mode becomes "bot" (the launch ordering)', () => {
    const { rerender } = renderHook(({ mode }: { mode: AppMode }) => useClearJourneyChallengeOutsideMatch(mode), { initialProps: { mode: 'journey' as AppMode } });
    launchDot();
    rerender({ mode: 'journey' }); // a render between setJourneyActiveChallenge and setAppMode('bot')
    expect(getJourneyActiveChallenge()).not.toBeNull();
  });

  it('survives React Strict Mode\'s simulated unmount/remount mid-match (why this is not an unmount cleanup)', () => {
    const challenge = launchDot();
    renderHook(({ mode }: { mode: AppMode }) => useClearJourneyChallengeOutsideMatch(mode), {
      initialProps: { mode: 'bot' as AppMode },
      wrapper: StrictMode,
    });
    expect(getJourneyActiveChallenge()).toEqual(challenge);
  });

  it.each(['journey', 'home', 'botSetup', 'singlePlayerHub'] as AppMode[])(
    'leaving match mode for "%s" by any route — including browser back or a swipe — drops the challenge and abandons the attempt',
    (destination) => {
      const { rerender } = renderHook(({ mode }: { mode: AppMode }) => useClearJourneyChallengeOutsideMatch(mode), { initialProps: { mode: 'journey' as AppMode } });
      const challenge = launchDot();
      rerender({ mode: 'bot' });
      expect(getJourneyActiveChallenge()).not.toBeNull();

      rerender({ mode: destination }); // no exit handler ran
      expect(getJourneyActiveChallenge()).toBeNull();
      expect(loadJourneyAttempts().find((attempt) => attempt.attemptId === challenge.attemptId)?.outcome).toBe('abandoned');
    },
  );

  it('never rewrites a result that was already recorded when the challenge is dropped', () => {
    const { rerender } = renderHook(({ mode }: { mode: AppMode }) => useClearJourneyChallengeOutsideMatch(mode), { initialProps: { mode: 'journey' as AppMode } });
    const challenge = launchDot();
    rerender({ mode: 'bot' });
    recordJourneyMatchOutcome({ attemptId: challenge.attemptId!, nodeId: DOT, won: true });
    rerender({ mode: 'journey' });
    expect(getJourneyActiveChallenge()).toBeNull();
    expect(loadJourneyAttempts().find((attempt) => attempt.attemptId === challenge.attemptId)?.outcome).toBe('won');
  });
});
