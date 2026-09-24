import { generateFullSet, tileEquals, type Tile } from '@racehorse/game-core';
import { tilesOnBoard } from '@racehorse/game-core/invariants';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { snapshotWithCausalEvidence } from './evidenceLifecycle';

export type ReviewHiddenPoolEligibility = {
  readonly eligibleForOpponent: readonly Tile[];
  readonly excludedTiles: readonly Tile[];
};

/**
 * Shared by sampleHiddenAllocation (B1) and solveExactEndgame (B2): derives
 * the full hidden tile pool for a snapshot and splits by causally-valid
 * knownMissingPipEvidence.
 */
export function resolveHiddenPoolEligibility(
  snapshot: ReviewPositionSnapshotV2,
  maxPips = 6,
): ReviewHiddenPoolEligibility {
  const { snapshot: feasible } = snapshotWithCausalEvidence(snapshot, maxPips);
  const { actorHand, board, knownMissingPipEvidence } = feasible.preAction;

  const knownTiles = [...actorHand, ...tilesOnBoard(board)];
  const hiddenPool = generateFullSet(maxPips).filter(
    (tile) => !knownTiles.some((known) => tileEquals(known, tile)),
  );

  const excludedPips = new Set(knownMissingPipEvidence.map((evidence) => evidence.pip));
  const isEligibleForOpponent = (tile: Tile) => !excludedPips.has(tile.low) && !excludedPips.has(tile.high);
  const eligibleForOpponent = hiddenPool.filter(isEligibleForOpponent);
  const excludedTiles = hiddenPool.filter((tile) => !isEligibleForOpponent(tile));

  return { eligibleForOpponent, excludedTiles };
}
