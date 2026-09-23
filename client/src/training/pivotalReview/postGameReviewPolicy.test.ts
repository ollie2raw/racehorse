import { describe, expect, it } from 'vitest';
import {
  isBotPostGameReviewEligible,
  isBotPostGameReviewLocallyEligible,
  isMultiplayerPostGameReviewEligible,
  isPlayVsFritzResultOverlayMode,
  isPositionalCoachingProseEnabled,
  isPostGameReviewEnabled,
  isReviewCaptureEnabled,
  type BotPostGameReviewContext,
} from './postGameReviewPolicy';
import { REVIEW_POSITIONAL_EXPLANATIONS_ENABLED } from '../../analyzer/reviewCoachingFacts';

const fritzMatch: BotPostGameReviewContext = {
  mode: 'bot',
  isGhostMode: false,
  isDailyFritzMode: false,
  isGuidedMode: false,
  isAuthoringMode: false,
  isAuthoringV2Mode: false,
  isGuidedV2Mode: false,
  isJourneyTrial: false,
};

describe('post-game review beta gate', () => {
  it('stays off until both the server cohort and client release flag are enabled', () => {
    expect(isPostGameReviewEnabled(false)).toBe(false);
    expect(isPostGameReviewEnabled(true)).toBe(true);
  });

  it('keeps the Play vs Fritz result overlay separate from cohort review visibility', () => {
    expect(isPlayVsFritzResultOverlayMode(fritzMatch)).toBe(true);
    expect(isBotPostGameReviewEligible({ ...fritzMatch, serverCohortEnabled: false })).toBe(false);
    expect(isBotPostGameReviewEligible({ ...fritzMatch, serverCohortEnabled: true })).toBe(true);
    expect(isBotPostGameReviewLocallyEligible({ ...fritzMatch, serverCohortEnabled: false })).toBe(true);
  });

  it('shows multiplayer Analyze Game only for cohort players', () => {
    expect(
      isMultiplayerPostGameReviewEligible({ gameOver: true, isTournament: false, serverCohortEnabled: false }),
    ).toBe(false);
    expect(
      isMultiplayerPostGameReviewEligible({ gameOver: true, isTournament: false, serverCohortEnabled: true }),
    ).toBe(true);
  });

  it('captures V2 snapshots on PVF independently of review visibility', () => {
    expect(isReviewCaptureEnabled({ ...fritzMatch, serverCohortEnabled: false })).toBe(true);
    expect(isReviewCaptureEnabled({ ...fritzMatch, isDailyFritzMode: true })).toBe(false);
    expect(isReviewCaptureEnabled({ ...fritzMatch, isJourneyTrial: true })).toBe(false);
    expect(isReviewCaptureEnabled({ ...fritzMatch, isGhostMode: true })).toBe(false);
  });

  it('Gate 4: positional prose requires ship constant + cohort + visible switch', () => {
    expect(REVIEW_POSITIONAL_EXPLANATIONS_ENABLED).toBe(true);
    expect(isPositionalCoachingProseEnabled(true)).toBe(true);
    expect(isPositionalCoachingProseEnabled(false)).toBe(false);
  });
});
