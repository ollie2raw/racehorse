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
export const BOT_OPENING_THINK_DELAY_MS = 1000;

/** Think between score/double chain continues (shorter than opening). */
export const BOT_CHAIN_CONTINUE_DELAY_MS = 825;

/** Opening beat when Fritz must dig the boneyard. */
export const BOT_FORCED_DRAW_THINK_DELAY_MS = 1650;

/**
 * @deprecated Prefer BOT_OPENING_THINK_DELAY_MS / resolveBotOpeningDelayMs.
 * Kept so older imports stay aligned with the opening think.
 */
export const BOT_THINK_DELAY_MS = BOT_OPENING_THINK_DELAY_MS;

/**
 * @deprecated Prefer BOT_FORCED_DRAW_THINK_DELAY_MS.
 */
export const BOT_FORCED_DRAW_DELAY_MS = BOT_FORCED_DRAW_THINK_DELAY_MS;

/** Per-tile draw cadence; 35% faster than the original 1325ms. */
export const BOT_DRAW_STEP_MS = 861;

/** Flying-tile animation duration (CSS + DOM cleanup should match). */
export const BOT_FLY_TILE_MS = 861;

/** Breath after draw-until-legal before Fritz plays the found tile. */
export const BOT_POST_DRAW_PLAY_DELAY_MS = 900;

/** Board place motion + settle after a tile lands. Must match place CSS. */
export const BOT_PLACE_SETTLE_MS = 650;

/** Score callout hold while points are on screen. */
export const BOT_SCORE_HOLD_MS = 1050;

/** Cue the score chip near the end of the tile's landing motion. */
export const BOT_SCORE_CUE_DELAY_MS = 400;

/** Settle your play before Fritz's thinking state begins. */
export const BOT_PLAYER_HANDOFF_DELAY_MS = 560;

/** Final “scored N this turn” settle when a scoring chain ends. */
export const BOT_CHAIN_END_SETTLE_MS = 1050;

/** Keep last-played highlight through chain steps. */
export const BOT_LAST_PLAYED_HOLD_MS = 3400;

/** Default score-toast hide/clear when not sticky (player scores, non-chain). */
export const BOT_SCORE_TOAST_HIDE_MS = 1200;
export const BOT_SCORE_TOAST_CLEAR_MS = 1500;

/**
 * How fast Fritz moves in Play vs Fritz. `normal` is the original cadence, unchanged. `fast` scales only
 * Fritz's PAUSES (think, hand-off, chain continue, post-draw beat, score hold) by FAST_PACE_SCALE. It never
 * touches an animation whose length is tied to CSS (the flying tile, the place settle), so nothing is cut
 * off mid-motion.
 */
export type FritzPace = 'normal' | 'fast';

export const FAST_PACE_SCALE = 0.4;

export function paceMs(ms: number, pace: FritzPace = 'normal'): number {
  return pace === 'fast' ? Math.round(ms * FAST_PACE_SCALE) : ms;
}

/**
 * The pace a match actually runs at. Daily Fritz is a verified daily result with one standard cadence, so it
 * ignores the preference and always runs at normal pace.
 */
export function resolveFritzPace(isDailyFritzMode: boolean, preference: FritzPace): FritzPace {
  return isDailyFritzMode ? 'normal' : preference;
}

/**
 * Fritz's draw ANIMATION at fast pace. The draw step and the flying tile are one motion (the step waits for the
 * tile to land), so they scale together, and by less than the pauses: an animation shrunk as hard as a pause reads as
 * a flicker, not a tile travelling. Normal pace is the original cadence, unchanged.
 */
export const FAST_DRAW_SCALE = 0.6;

export function paceDrawMs(ms: number, pace: FritzPace = 'normal'): number {
  return pace === 'fast' ? Math.round(ms * FAST_DRAW_SCALE) : ms;
}

/** How long Fritz waits per drawn tile (the step and the flying tile are the same length). */
export function resolveBotDrawStepMs(pace: FritzPace = 'normal'): number {
  return paceDrawMs(BOT_DRAW_STEP_MS, pace);
}

/**
 * The base length of the flying tile's CSS animation (`.flying-tile-overlay` in walnut-live.css). The overlay is
 * removed after BOT_FLY_TILE_MS (861), so at normal pace it has always been cut at ~76% of the animation; that is
 * the look. A faster flight must keep the SAME shape, so its CSS length scales by this ratio, not by the cleanup time.
 */
export const FLY_TILE_CSS_BASE_MS = 1138;

export function flyTileCssMs(flyMs: number): number {
  return Math.round((flyMs * FLY_TILE_CSS_BASE_MS) / BOT_FLY_TILE_MS);
}

/** How long the flying tile for one of Fritz's draws is on screen. Matches the step so nothing is cut off. */
export function resolveBotFlyTileMs(pace: FritzPace = 'normal'): number {
  return paceDrawMs(BOT_FLY_TILE_MS, pace);
}

export function resolveBotOpeningDelayMs(hasLegalMove: boolean, pace: FritzPace = 'normal'): number {
  return paceMs(hasLegalMove ? BOT_OPENING_THINK_DELAY_MS : BOT_FORCED_DRAW_THINK_DELAY_MS, pace);
}

export function resolveBotChainContinueDelayMs(pace: FritzPace = 'normal'): number {
  return paceMs(BOT_CHAIN_CONTINUE_DELAY_MS, pace);
}

/** Settle your play before Fritz's thinking state begins. */
export function resolveBotHandoffDelayMs(pace: FritzPace = 'normal'): number {
  return paceMs(BOT_PLAYER_HANDOFF_DELAY_MS, pace);
}

/** Breath after draw-until-legal before Fritz plays the found tile. */
export function resolveBotPostDrawPlayDelayMs(pace: FritzPace = 'normal'): number {
  return paceMs(BOT_POST_DRAW_PLAY_DELAY_MS, pace);
}

/**
 * After apply+flash(+score), how long to hold before the next beat. The place settle is tied to the place
 * animation's CSS and never shrinks, so a scored move at fast pace holds for the settle, not below it.
 */
export function resolveBotPostActionSettleMs(scoredPoints: number, pace: FritzPace = 'normal'): number {
  if (scoredPoints > 0) {
    return Math.max(BOT_PLACE_SETTLE_MS, paceMs(BOT_SCORE_HOLD_MS, pace));
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
