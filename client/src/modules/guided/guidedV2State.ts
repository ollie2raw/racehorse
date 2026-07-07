import type { Tile } from '../../types.ts';
import type { BotMatchState, BotPlayerId } from '../match/runtime/botEngine.ts';
import { guidedWinnerIdFromScores, syncGuidedBoneyardCount } from './guidedBotMatchHelpers.ts';
import { parseTileKey } from '../../game/tileKeys.ts';
import type { LessonV2Event } from '../../learn/lessonV2.ts';
import { parseLessonV2BoardState } from '../match/bootstrap/lessonV2LazyRegistry.ts';

export function resolveNextPlayerAfterV2Event(event: LessonV2Event): BotPlayerId {
  if (event.handOver || event.gameOver) return 'you';
  if (event.turnContinues) {
    return event.actor === 'fritz' ? 'bot' : 'you';
  }
  return event.actor === 'fritz' ? 'you' : 'bot';
}

export function parseV2EventHands(event: LessonV2Event): { playerHand: Tile[]; fritzHand: Tile[] } {
  const playerHand = event.playerHandAfter
    .map((k) => parseTileKey(k))
    .filter((t): t is Tile => t !== null);
  const fritzHand = event.fritzHandAfter
    .map((k) => parseTileKey(k))
    .filter((t): t is Tile => t !== null);
  return { playerHand, fritzHand };
}

export function buildBotMatchStateFromV2Event(
  currentState: BotMatchState,
  event: LessonV2Event,
): BotMatchState {
  const board = parseLessonV2BoardState(event.boardAfter);
  const { playerHand, fritzHand } = parseV2EventHands(event);
  const nextPlayer = resolveNextPlayerAfterV2Event(event);

  return {
    ...currentState,
    board,
    handOpen: Boolean(board && board.mainLine && board.mainLine.length > 0),
    boneyard: syncGuidedBoneyardCount(currentState.boneyard, event.boneyardCountAfter),
    players: {
      you: { ...currentState.players.you, hand: playerHand, score: event.playerScoreAfter },
      bot: { ...currentState.players.bot, hand: fritzHand, score: event.fritzScoreAfter },
    },
    currentPlayer: nextPlayer,
    handOver: event.handOver,
    gameOver: event.gameOver,
    handNumber: event.handNumber,
    winnerId: event.gameOver
      ? guidedWinnerIdFromScores(event.playerScoreAfter, event.fritzScoreAfter)
      : currentState.winnerId,
  };
}