import { POST_GAME_REVIEW_VISIBLE } from '../../appRouteTypes';

/**
 * Post-game review eligibility (v1).
 *
 * Daily Fritz is intentionally deferred — not a runtime flag toggle today.
 * It is structurally excluded because Daily Fritz runs under mode `daily-fritz`
 * (not `bot`), with its own set-progression / final overlays. Re-enable when
 * set-final flow can host the review prompt without fighting hand interstitials.
 *
 * Visibility is gated by the server cohort response and the client release
 * constant; the latter is the deployment rollback switch.
 */
export const POST_GAME_REVIEW_DEFERRED_DAILY_FRITZ = true;

export function isPostGameReviewEnabled(serverCohortEnabled = false): boolean {
  return Boolean(serverCohortEnabled && POST_GAME_REVIEW_VISIBLE);
}

export type BotPostGameReviewContext = {
  mode: string;
  isGhostMode: boolean;
  isDailyFritzMode: boolean;
  isGuidedMode: boolean;
  isAuthoringMode: boolean;
  isAuthoringV2Mode: boolean;
  isGuidedV2Mode: boolean;
  isJourneyTrial: boolean;
  serverCohortEnabled?: boolean;
};

/** Play vs Fritz result overlay modes (broader than review eligibility). */
export function isPlayVsFritzResultOverlayMode(ctx: BotPostGameReviewContext): boolean {
  return (
    ctx.mode === 'bot' &&
    !ctx.isGhostMode &&
    !ctx.isDailyFritzMode &&
    !ctx.isGuidedMode &&
    !ctx.isAuthoringMode &&
    !ctx.isAuthoringV2Mode &&
    !ctx.isGuidedV2Mode
  );
}

/** Post-game review prompt on standard Play vs Fritz (excludes Journey trial). */
export function isBotPostGameReviewEligible(ctx: BotPostGameReviewContext): boolean {
  return (
    isBotPostGameReviewLocallyEligible(ctx) &&
    ctx.serverCohortEnabled === true
  );
}

/** Local post-game review experience; persistence is gated separately. */
export function isBotPostGameReviewLocallyEligible(ctx: BotPostGameReviewContext): boolean {
  return (
    POST_GAME_REVIEW_VISIBLE &&
    isPlayVsFritzResultOverlayMode(ctx) &&
    !ctx.isJourneyTrial
  );
}

/**
 * Live V2 snapshot capture gate (Phase A3+).
 *
 * Mode-scoped only — does not require the beta post-game review UI / admin
 * flag — so PVF sessions still accumulate snapshots while the analyzer stays
 * hidden from players. Excludes Daily Fritz, ghost, guided, authoring, and
 * Journey trial so DF verification payloads stay untouched.
 */
export function isReviewCaptureEnabled(ctx: BotPostGameReviewContext): boolean {
  return isPlayVsFritzResultOverlayMode(ctx) && !ctx.isJourneyTrial;
}

export function isMultiplayerPostGameReviewEligible(input: {
  gameOver: boolean;
  isTournament: boolean;
  serverCohortEnabled?: boolean;
}): boolean {
  return isPostGameReviewEnabled(input.serverCohortEnabled) && input.gameOver && !input.isTournament;
}

export function isMultiplayerPostGameReviewLocallyEligible(input: {
  gameOver: boolean;
  isTournament: boolean;
}): boolean {
  return POST_GAME_REVIEW_VISIBLE && input.gameOver && !input.isTournament;
}
