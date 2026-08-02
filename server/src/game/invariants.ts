export {
  boardTileCount,
  collectGameStateViolations,
  collectTileAccountingViolations,
  isValidTile,
  tileKey,
  tilesOnBoard,
} from '@racehorse/game-core';
import {
  collectGameStateViolations,
  collectTileAccountingViolations,
  type GameState,
} from '@racehorse/game-core';

function reportViolations(violations: string[], context: string): void {
  if (violations.length === 0) return;
  const message = `[invariant:${context}] ${violations.length} violation(s):\n${violations.map((value) => `  - ${value}`).join('\n')}`;
  // Fail closed by default — soft logging only when explicitly opted in.
  // Chess.com-grade private matches must not continue on tile accounting corruption.
  if (process.env.SOFT_GAME_INVARIANTS === 'true') {
    console.error(message);
    return;
  }
  throw new Error(message);
}

export function assertTileCountInvariant(
  state: GameState,
  context = 'unknown',
  expectedTotalOverride?: number,
): void {
  reportViolations(collectTileAccountingViolations(state, expectedTotalOverride), context);
}

export function assertValidGameState(
  state: GameState,
  context = 'unknown',
  expectedTotalOverride?: number,
): void {
  reportViolations(collectGameStateViolations(state, expectedTotalOverride), context);
}
