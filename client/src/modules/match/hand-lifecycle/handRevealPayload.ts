import type { BotActionResult } from '../runtime/botEngine.ts';
import type { BotHandReveal } from '../types.ts';

/** Build the hand-over reveal payload from a bot action that ended the hand. */
export function buildHandRevealFromResult(result: BotActionResult): BotHandReveal {
  const handEndedData = result.handEnded!;
  return {
    winner: handEndedData.winner,
    reason: handEndedData.reason,
    pointsAwarded: handEndedData.pointsAwarded,
    loserPips: handEndedData.loserPips,
    calcText: handEndedData.calcText,
    yourRemainingTiles: result.state.players.you.hand,
    botRemainingTiles: result.state.players.bot.hand,
  };
}