import { describe, expect, it } from 'vitest';
import {
  isBotPostGameReviewEligible,
  isMultiplayerPostGameReviewEligible,
  isPlayVsFritzResultOverlayMode,
  isPostGameReviewEnabled,
  type BotPostGameReviewContext,
} from './postGameReviewPolicy';

const fritzMatch: BotPostGameReviewContext = {
  mode: 'bot',
  isGhostMode: false,
  isDailyFritzMode: false,
  isDailyPuzzleRun: false,
  isGuidedMode: false,
  isAuthoringMode: false,
  isAuthoringV2Mode: false,
  isGuidedV2Mode: false,
  isJourneyTrial: false,
};

describe('post-game review beta gate', () => {
  it('is off for players and on for the admin account', () => {
    expect(isPostGameReviewEnabled(false)).toBe(false);
    expect(isPostGameReviewEnabled(true)).toBe(true);
  });

  it('still shows the Play vs Fritz result overlay without review', () => {
    expect(isPlayVsFritzResultOverlayMode(fritzMatch)).toBe(true);
    expect(isBotPostGameReviewEligible({ ...fritzMatch, isAdmin: false })).toBe(false);
    expect(isBotPostGameReviewEligible({ ...fritzMatch, isAdmin: true })).toBe(true);
  });

  it('hides multiplayer Analyze Game for players', () => {
    expect(
      isMultiplayerPostGameReviewEligible({ gameOver: true, isTournament: false, isAdmin: false }),
    ).toBe(false);
    expect(
      isMultiplayerPostGameReviewEligible({ gameOver: true, isTournament: false, isAdmin: true }),
    ).toBe(true);
  });
});
