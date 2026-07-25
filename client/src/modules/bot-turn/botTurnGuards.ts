import {
  isDailyFritzSetTerminal,
  shouldAllowBotAction,
  type BotMatchLifecycleSnapshot,
} from '../match/hand-lifecycle/handLifecycleRules.ts';

/**
 * Single Fritz turn-start beat (play, draw start, and score/double chain continues).
 * Kept deliberately human-paced so Daily Fritz feels like a real match.
 */
export const BOT_THINK_DELAY_MS = 2000;

/**
 * @deprecated Use BOT_THINK_DELAY_MS — kept as an alias so older imports stay aligned.
 * Forced-draw starts use the same beat as plays.
 */
export const BOT_FORCED_DRAW_DELAY_MS = BOT_THINK_DELAY_MS;

/** Per-tile draw cadence; one tile at a time. Must match flying-tile CSS duration. */
export const BOT_DRAW_STEP_MS = 1600;

/** Flying-tile animation duration (CSS + DOM cleanup should match). */
export const BOT_FLY_TILE_MS = 1600;

/** Breath after draw-until-legal before Fritz plays the found tile. */
export const BOT_POST_DRAW_PLAY_DELAY_MS = 1000;

export function resolveBotTurnDelayMs(_hasLegalMove = true): number {
  return BOT_THINK_DELAY_MS;
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
