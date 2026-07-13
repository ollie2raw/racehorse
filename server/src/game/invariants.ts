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
  if (process.env.NODE_ENV === 'production') console.error(message);
  else throw new Error(message);
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
