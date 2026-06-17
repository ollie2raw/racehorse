import { POST_GAME_REVIEW_VISIBLE } from '../../appRouteTypes';

/**
 * Post-game review eligibility (v1).
 *
 * Daily Fritz is intentionally deferred — not a runtime flag toggle today.
 * It is structurally excluded because Daily Fritz runs under mode `daily-fritz`
 * (not `bot`), with its own set-progression / final overlays. Re-enable when
 * set-final flow can host the review prompt without fighting hand interstitials.
 */
export const POST_GAME_REVIEW_DEFERRED_DAILY_FRITZ = true;

export function isPostGameReviewEnabled(): boolean {
  return POST_GAME_REVIEW_VISIBLE;
}

export type BotPostGameReviewContext = {
  mode: string;
  isGhostMode: boolean;
  isDailyFritzMode: boolean;
  isDailyPuzzleRun: boolean;
  isGuidedMode: boolean;
  isAuthoringMode: boolean;
  isAuthoringV2Mode: boolean;
  isGuidedV2Mode: boolean;
  isJourneyTrial: boolean;
};

/** Play vs Fritz result overlay modes (broader than review eligibility). */
export function isPlayVsFritzResultOverlayMode(ctx: BotPostGameReviewContext): boolean {
  return (
    ctx.mode === 'bot' &&
    !ctx.isGhostMode &&
    !ctx.isDailyFritzMode &&
    !ctx.isDailyPuzzleRun &&
    !ctx.isGuidedMode &&
    !ctx.isAuthoringMode &&
    !ctx.isAuthoringV2Mode &&
    !ctx.isGuidedV2Mode
  );
}

/** Post-game review prompt on standard Play vs Fritz (excludes Journey trial). */
export function isBotPostGameReviewEligible(ctx: BotPostGameReviewContext): boolean {
  return (
    isPostGameReviewEnabled() &&
    isPlayVsFritzResultOverlayMode(ctx) &&
    !ctx.isJourneyTrial
  );
}

export function isMultiplayerPostGameReviewEligible(input: {
  gameOver: boolean;
  isTournament: boolean;
}): boolean {
  return isPostGameReviewEnabled() && input.gameOver && !input.isTournament;
}
