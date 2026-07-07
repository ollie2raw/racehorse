import { dailyFritzDebugLog, traceDailyFritzEvent } from '../daily/dailyFritzMatchDiagnostics.ts';
import type { BotActionResult, BotMatchState } from '../match/runtime/botEngine.ts';
import { toTileKey } from '../../game/tileKeys.ts';
import type { Move, PlacementPosition, Tile } from '../../types.ts';

export function traceDailyFritzPlacementClick(input: {
  position: PlacementPosition;
  selectedTile: Tile | null;
  match: BotMatchState;
}): void {
  traceDailyFritzEvent('[input] placement click', {
    position: input.position,
    selectedTile: input.selectedTile ? toTileKey(input.selectedTile) : null,
    currentPlayer: input.match.currentPlayer,
    handOver: input.match.handOver,
    gameOver: input.match.gameOver,
  });
}

export function traceDailyFritzMoveApplied(move: Move): void {
  traceDailyFritzEvent('[state] move applied', {
    tile: move.tile ? toTileKey(move.tile) : null,
    position: move.position ?? null,
  });
}

export function logDailyFritzLockedBoneyardDetected(match: BotMatchState): void {
  dailyFritzDebugLog('[daily-flow] locked boneyard no-move detected', {
    handNumber: match.handNumber,
    yourScore: match.players.you.score,
    botScore: match.players.bot.score,
    boneyardLength: match.boneyard.length,
    consecutivePasses: match.consecutivePasses,
  });
}

export function logDailyFritzBlockedHandResolved(result: BotActionResult): void {
  dailyFritzDebugLog('[daily-flow] blocked hand resolved', {
    handEnded: Boolean(result.handEnded),
    yourScore: result.state.players.you.score,
    botScore: result.state.players.bot.score,
    gameOver: result.state.gameOver,
  });
  if (result.state.gameOver) {
    dailyFritzDebugLog('[daily-flow] winning score already reached -> match complete', {
      handNumber: result.state.handNumber,
      winnerId: result.state.winnerId,
      yourScore: result.state.players.you.score,
      botScore: result.state.players.bot.score,
    });
  }
}