import type { EngineBestMove } from '../../game/moveLogger.ts';
import { toTileTuple } from '../../game/moveLogger.ts';
import type { Tile } from '../../types.ts';
import {
  getLegalMoves,
  type BotMatchState,
} from '../match/runtime/botEngine.ts';
import {
  chooseBotMove,
  toBotVisibleState,
  type BotChoice,
  type BotDifficulty,
} from '../fritz/botHeuristics.ts';
import { fairnessLog } from '../match/runtime/fairnessLog.ts';

export function getFritzBestMove(
  state: BotMatchState,
  difficulty: BotDifficulty,
): EngineBestMove | null {
  // chooseBotMove always evaluates for 'bot' player.
  // When it's your turn, mirror the state so your hand
  // is in the bot slot for evaluation.
  const evalState: BotMatchState = state.currentPlayer === 'you'
    ? {
        ...state,
        currentPlayer: 'bot',
        opponentPassedOnEnds: [],
        opponentDrawCount: 0,
        opponentKnownMissing: [],
        players: {
          you: state.players.bot,
          bot: state.players.you,
        },
      }
    : state;
  const choice = chooseBotMove(toBotVisibleState(evalState), difficulty);
  if (!choice || !choice.move.tile) return null;
  return {
    tile: toTileTuple(choice.move.tile as Tile),
    position: choice.move.position,
    score: choice.score,
    breakdown: choice.breakdown,
  };
}

export function toEngineBestFromChoice(choice: BotChoice | null): EngineBestMove | null {
  if (!choice || !choice.move.tile) return null;
  return {
    tile: toTileTuple(choice.move.tile as Tile),
    position: choice.move.position,
    score: choice.score,
    breakdown: choice.breakdown,
  };
}

export function logFritzFairnessDecision(state: BotMatchState, choice: BotChoice | null): void {
  if (!choice?.move) return;
  fairnessLog('fritz-move', {
    handNumber: state.handNumber,
    turnIndex: state.turnIndex,
    legalMoves: getLegalMoves(state, 'bot')
      .filter((m) => m.type === 'play')
      .map((m) => ({
        tile: m.tile ? `${m.tile.low}-${m.tile.high}` : null,
        position: m.position ?? null,
      })),
    chosen: choice.move.tile
      ? { tile: `${choice.move.tile.low}-${choice.move.tile.high}`, position: choice.move.position ?? null }
      : choice.move.type,
    boneyardCount: state.boneyard.length,
  });
}