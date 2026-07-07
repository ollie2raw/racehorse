import type { BotActionResult } from '../match/runtime/botEngine.ts';

export function computeBotChainPaused(result: BotActionResult): boolean {
  return result.state.currentPlayer === 'bot' && !result.state.handOver && !result.state.gameOver;
}