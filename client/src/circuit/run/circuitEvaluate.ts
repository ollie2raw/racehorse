/**
 * Client adapter only — grading/scoring/scenarios live in @racehorse/game-core.
 */
import {
  createDecisionContextFromScenario,
  evaluateCircuitMove,
  type CircuitDecisionContext,
  type CircuitDecisionGrade,
  type CircuitEvaluationResult,
  type CircuitMoveRef,
  type CircuitScenario,
  type GameState,
} from '@racehorse/game-core';
import type { BotMatchState } from '../../modules/match/runtime/botEngine';
import type { PlacementPosition, Tile } from '../../types';

export type { CircuitDecisionContext, CircuitDecisionGrade, CircuitEvaluationResult, CircuitMoveRef };

/** UI-facing alias for an active decision (shared context + display helpers). */
export type CircuitActiveDecision = CircuitDecisionContext;

export function createActiveDecisionFromScenario(
  scenario: CircuitScenario,
  stepIndex = 0,
): CircuitActiveDecision {
  return createDecisionContextFromScenario(scenario, stepIndex);
}

export function evaluateCircuitDecision(
  active: CircuitActiveDecision,
  chosen: CircuitMoveRef,
): CircuitEvaluationResult {
  return evaluateCircuitMove(active, chosen);
}

export function advanceCheckpointDecision(
  scenario: Extract<CircuitScenario, { kind: 'checkpoint_hand' }>,
  nextStepIndex: number,
): CircuitActiveDecision | null {
  if (nextStepIndex >= scenario.steps.length) return null;
  return createDecisionContextFromScenario(scenario, nextStepIndex);
}

export function gameStateToBotMatch(state: GameState): BotMatchState {
  const player = state.players.player;
  const opponent = state.players.opponent;
  if (!player || !state.board) {
    throw new Error('[Circuit] Invalid game state for board render');
  }
  return {
    players: {
      you: { hand: player.hand.map((t) => ({ ...t })), score: player.score },
      bot: {
        hand: (opponent?.hand ?? []).map((t) => ({ ...t })),
        score: opponent?.score ?? 0,
      },
    },
    board: {
      mainLine: state.board.mainLine.map((p) => ({
        tile: { ...p.tile },
        orientation: p.orientation,
      })),
      leftEnd: state.board.leftEnd,
      rightEnd: state.board.rightEnd,
      leftEndIsDouble: state.board.leftEndIsDouble,
      rightEndIsDouble: state.board.rightEndIsDouble,
      hubDoubles: state.board.hubDoubles.map((hub) => ({
        ...hub,
        branches: hub.branches.map((arm) =>
          arm
            ? {
                openEnd: arm.openEnd,
                openEndIsDouble: arm.openEndIsDouble,
                tiles: arm.tiles.map((p) => ({ tile: { ...p.tile }, orientation: p.orientation })),
              }
            : null,
        ),
      })),
    },
    boneyard: [],
    deadTiles: [],
    handOpen: true,
    currentPlayer: 'you',
    consecutivePasses: 0,
    handNumber: 1,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore: 999,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize: 7,
  };
}

export function moveFromTileAndPosition(tile: Tile, position: PlacementPosition): CircuitMoveRef {
  return { tile: { low: tile.low, high: tile.high }, position };
}
