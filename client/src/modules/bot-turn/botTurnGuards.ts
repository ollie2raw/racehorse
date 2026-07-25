import {
  isDailyFritzSetTerminal,
  shouldAllowBotAction,
  type BotMatchLifecycleSnapshot,
} from '../match/hand-lifecycle/handLifecycleRules.ts';

/**
 * Fritz cadence theater timings (Daily Fritz + Play vs Fritz).
 * Variable beats: opening reads are longer than chain continues.
 * Keep CSS durations (fly / place) aligned with the matching *_MS constants.
 */

/** Opening think when Fritz has a legal play. */
export const BOT_OPENING_THINK_DELAY_MS = 1300;

/** Think between score/double chain continues (shorter than opening). */
export const BOT_CHAIN_CONTINUE_DELAY_MS = 1100;

/** Opening beat when Fritz must dig the boneyard. */
export const BOT_FORCED_DRAW_THINK_DELAY_MS = 2200;

/**
 * @deprecated Prefer BOT_OPENING_THINK_DELAY_MS / resolveBotOpeningDelayMs.
 * Kept so older imports stay aligned with the opening think.
 */
export const BOT_THINK_DELAY_MS = BOT_OPENING_THINK_DELAY_MS;

/**
 * @deprecated Prefer BOT_FORCED_DRAW_THINK_DELAY_MS.
 */
export const BOT_FORCED_DRAW_DELAY_MS = BOT_FORCED_DRAW_THINK_DELAY_MS;

/** Per-tile draw cadence; one tile at a time. Must match flying-tile CSS duration. */
export const BOT_DRAW_STEP_MS = 1750;

/** Flying-tile animation duration (CSS + DOM cleanup should match). */
export const BOT_FLY_TILE_MS = 1750;

/** Breath after draw-until-legal before Fritz plays the found tile. */
export const BOT_POST_DRAW_PLAY_DELAY_MS = 1200;

/** Board place motion + settle after a tile lands. Must match place CSS. */
export const BOT_PLACE_SETTLE_MS = 850;

/** Score callout hold while points are on screen. */
export const BOT_SCORE_HOLD_MS = 1400;

/** Settle your play before Fritz's thinking state begins. */
export const BOT_PLAYER_HANDOFF_DELAY_MS = 750;

/** Final “scored N this turn” settle when a scoring chain ends. */
export const BOT_CHAIN_END_SETTLE_MS = 1400;

/** Keep last-played highlight through chain steps. */
export const BOT_LAST_PLAYED_HOLD_MS = 4500;

/** Default score-toast hide/clear when not sticky (player scores, non-chain). */
export const BOT_SCORE_TOAST_HIDE_MS = 1600;
export const BOT_SCORE_TOAST_CLEAR_MS = 2000;

export function resolveBotOpeningDelayMs(hasLegalMove: boolean): number {
  return hasLegalMove ? BOT_OPENING_THINK_DELAY_MS : BOT_FORCED_DRAW_THINK_DELAY_MS;
}

export function resolveBotChainContinueDelayMs(): number {
  return BOT_CHAIN_CONTINUE_DELAY_MS;
}

/** After apply+flash(+score), how long to hold before the next beat. */
export function resolveBotPostActionSettleMs(scoredPoints: number): number {
  if (scoredPoints > 0) {
    return Math.max(BOT_PLACE_SETTLE_MS, BOT_SCORE_HOLD_MS);
  }
  return BOT_PLACE_SETTLE_MS;
}

/**
 * @deprecated Prefer resolveBotOpeningDelayMs — kept for older call sites.
 */
export function resolveBotTurnDelayMs(hasLegalMove = true): number {
  return resolveBotOpeningDelayMs(hasLegalMove);
}

export function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export type BotTurnSchedulingContext = {
  match: BotMatchLifecycleSnapshot;
  drawSequenceActive: boolean;
  /** True while a bot action (including chain continues) is executing. */
  botTurnInFlight: boolean;
  preGameDrawActive: boolean;
  isDailyFritzMode: boolean;
  dailyFritzSetResult?: { setWinner?: string | null } | null;
  isGuidedTranscriptMode: boolean;
  isGuidedV2Mode: boolean;
  isGuidedV2OffLine: boolean;
};

export function shouldScheduleBotTurn(ctx: BotTurnSchedulingContext): boolean {
  if (!shouldAllowBotAction(ctx.match) || ctx.drawSequenceActive || ctx.botTurnInFlight) {
    return false;
  }
  if (ctx.preGameDrawActive) return false;
  if (ctx.isDailyFritzMode && isDailyFritzSetTerminal(ctx.dailyFritzSetResult)) return false;
  if (ctx.isGuidedTranscriptMode) return false;
  if (ctx.isGuidedV2Mode && !ctx.isGuidedV2OffLine) return false;
  return true;
}

export function shouldContinueBotTurnAtTimer(input: {
  match: BotMatchLifecycleSnapshot;
  isDailyFritzMode: boolean;
  dailyFritzSetResult?: { setWinner?: string | null } | null;
}): boolean {
  if (!shouldAllowBotAction(input.match)) return false;
  if (input.isDailyFritzMode && isDailyFritzSetTerminal(input.dailyFritzSetResult)) return false;
  return true;
}
