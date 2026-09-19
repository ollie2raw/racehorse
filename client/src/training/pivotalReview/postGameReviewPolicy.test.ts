import { describe, expect, it } from 'vitest';
import {
  isBotPostGameReviewEligible,
  isMultiplayerPostGameReviewEligible,
  isPlayVsFritzResultOverlayMode,
  isPostGameReviewEnabled,
  isReviewCaptureEnabled,
  type BotPostGameReviewContext,
} from './postGameReviewPolicy';

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
    expect(isPostGameReviewEnabled(true)).toBe(false);
  });

  it('still shows the Play vs Fritz result overlay without review', () => {
    expect(isPlayVsFritzResultOverlayMode(fritzMatch)).toBe(true);
    expect(isBotPostGameReviewEligible({ ...fritzMatch, serverCohortEnabled: false })).toBe(false);
    expect(isBotPostGameReviewEligible({ ...fritzMatch, serverCohortEnabled: true })).toBe(false);
  });

  it('hides multiplayer Analyze Game for players', () => {
    expect(
      isMultiplayerPostGameReviewEligible({ gameOver: true, isTournament: false, serverCohortEnabled: false }),
    ).toBe(false);
    expect(
      isMultiplayerPostGameReviewEligible({ gameOver: true, isTournament: false, serverCohortEnabled: true }),
    ).toBe(false);
  });

  it('captures V2 snapshots on PVF even when the review UI is beta-hidden', () => {
    expect(isReviewCaptureEnabled({ ...fritzMatch, serverCohortEnabled: false })).toBe(true);
    expect(isReviewCaptureEnabled({ ...fritzMatch, isDailyFritzMode: true })).toBe(false);
    expect(isReviewCaptureEnabled({ ...fritzMatch, isJourneyTrial: true })).toBe(false);
    expect(isReviewCaptureEnabled({ ...fritzMatch, isGhostMode: true })).toBe(false);
  });
});
