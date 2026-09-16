import { simulatePlacement } from '@racehorse/game-core';
import type { ReviewPrincipalVariationStep } from '@racehorse/game-core/review';
import type { BoardState } from '../types';

/**
 * Phase D3 (game-review-oracle-upgrade-2026-09-13.md): pure board-stepping
 * for a principal variation line, from the pre-move position. Reuses
 * `simulatePlacement` (re-exported from game-core's root barrel, which
 * itself re-exports everything from scoring.ts -- imported from the root
 * rather than a `/scoring` subpath since that's the only game-core
 * specifier Vite's alias config resolves for a bare, non-`/scoring`-
 * suffixed import; see vite.config.ts's resolve.alias list) -- the exact
 * same pure board-transformation primitive `reviewContracts.ts` itself
 * already uses internally -- rather than re-deriving placement/scoring
 * logic client-side.
 *
 * A `ReviewPrincipalVariationStep` only carries the action taken, not a
 * board snapshot (see reviewContracts.ts), so the board after each step
 * must be reconstructed by simulating forward from the known pre-move
 * board. pass/draw steps don't change the board, so the same board
 * reference carries forward unchanged for those.
 *
 * Returns an array of length `steps.length + 1`: index 0 is the untouched
 * pre-move board (before any PV step), index i is the board after
 * applying steps[0..i-1]. An empty `steps` array (the honest reality for
 * every solver tier today -- see reviewCoachingFacts.ts) returns a
 * single-element array containing only the pre-move board, not an error.
 */
export function stepPrincipalVariationBoards(
  preMoveBoard: BoardState | null,
  steps: readonly ReviewPrincipalVariationStep[],
): readonly (BoardState | null)[] {
  const boards: (BoardState | null)[] = [preMoveBoard];
  let board = preMoveBoard;
  for (const step of steps) {
    if (step.action.kind === 'play') {
      board = simulatePlacement(board, step.action.tile, step.action.position);
    }
    boards.push(board);
  }
  return boards;
}

/** Short, honest-only label for one PV step -- derived solely from real step fields. */
export function describePrincipalVariationStep(step: ReviewPrincipalVariationStep, opponentLabel: string): string {
  const actorLabel = step.actor === 'reviewed-player' ? 'You' : opponentLabel;
  if (step.action.kind === 'pass') return `${actorLabel} pass`;
  if (step.action.kind === 'draw') return `${actorLabel} draw`;
  const { tile, position } = step.action;
  const tileText = `${tile.low}-${tile.high}`;
  const pointsText = step.immediatePoints > 0 ? ` (+${step.immediatePoints})` : '';
  return `${actorLabel} play ${tileText} at ${position}${pointsText}`;
}
