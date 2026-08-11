import { simulatePlacement } from '@racehorse/game-core';
import type { BoardState, Tile } from '../types.ts';
import type { MoveEntry } from '../game/moveLogger.ts';
import { normalizeBoardRenderState } from '../game/moveLogger.ts';

/**
 * Move logs intentionally retain the pre-action board for evaluation. Game Review,
 * however, presents a selected move as completed, so its board must include that
 * action. Derive that post-action projection without changing the logging contract.
 */
export function derivePostMoveReviewBoard(entry: MoveEntry): BoardState | null {
  const before = normalizeBoardRenderState(entry.boardRenderState);
  if (entry.action !== 'place' || !entry.tile || !entry.position) return before;

  try {
    const tile: Tile = { low: entry.tile[0], high: entry.tile[1] };
    const after = simulatePlacement(before, tile, entry.position) as unknown as BoardState;
    return normalizeBoardRenderState(after);
  } catch {
    // A malformed legacy snapshot should remain reviewable at its last known state.
    // Evaluation and telemetry can still identify the incomplete reconstruction.
    return before;
  }
}
