import {
  isDailyFritzSetTerminal,
  shouldAllowBotAction,
  type BotMatchLifecycleSnapshot,
} from '../match/hand-lifecycle/handLifecycleRules.ts';

export const BOT_THINK_DELAY_MS = 900;
export const BOT_FORCED_DRAW_DELAY_MS = 80;
export const BOT_DRAW_STEP_MS = 420;

export function resolveBotTurnDelayMs(hasLegalMove: boolean): number {
  return hasLegalMove ? BOT_THINK_DELAY_MS : BOT_FORCED_DRAW_DELAY_MS;
}

export type BotTurnSchedulingContext = {
  match: BotMatchLifecycleSnapshot;
  drawSequenceActive: boolean;
  preGameDrawActive: boolean;
  isDailyFritzMode: boolean;
  dailyFritzSetResult?: { setWinner?: string | null } | null;
  isGuidedTranscriptMode: boolean;
  isGuidedV2Mode: boolean;
  isGuidedV2OffLine: boolean;
};

export function shouldScheduleBotTurn(ctx: BotTurnSchedulingContext): boolean {
  if (!shouldAllowBotAction(ctx.match) || ctx.drawSequenceActive) return false;
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
