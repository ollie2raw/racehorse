import { generateFullSet, tileEquals, type Tile } from '@racehorse/game-core';
import { tilesOnBoard } from '@racehorse/game-core/invariants';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';

export type ReviewHiddenPoolEligibility = {
  readonly eligibleForOpponent: readonly Tile[];
  readonly excludedTiles: readonly Tile[];
};

/**
 * Shared by sampleHiddenAllocation (B1) and solveExactEndgame (B2): derives
 * the full hidden tile pool for a snapshot (every tile not in the actor's
 * hand or on the board) and splits it into tiles still eligible for the
 * opponent's hand versus those knownMissingPipEvidence rules out for them
 * (excludedTiles can still be in the boneyard, just not in the opponent's
 * hand).
 *
 * generateFullSet iterates two plain nested for-loops over fixed numeric
 * ranges (packages/game-core/src/types.ts) — not Set/object-keyed, so its
 * order is fixed and reproducible for a given maxPips. tilesOnBoard walks
 * mainLine then each hub's branches in array order (also game-core). The
 * `.filter` calls below preserve the relative order of `generateFullSet`'s
 * output for every tile they keep (Array.prototype.filter is
 * order-preserving by spec) — so both returned arrays are deterministic for a
 * given (snapshot, maxPips), independent of any caller's later seeded
 * shuffling.
 */
export function resolveHiddenPoolEligibility(
  snapshot: ReviewPositionSnapshotV2,
  maxPips = 6,
): ReviewHiddenPoolEligibility {
  const { actorHand, board, knownMissingPipEvidence } = snapshot.preAction;

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
