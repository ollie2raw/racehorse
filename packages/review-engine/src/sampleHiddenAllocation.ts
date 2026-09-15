import {
  createDeterministicRandom,
  generateFullSet,
  shuffleDeterministically,
  tileEquals,
  type Tile,
} from '@racehorse/game-core';
import { tilesOnBoard } from '@racehorse/game-core/invariants';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';

export type ReviewHiddenAllocation = {
  readonly opponentHand: readonly Tile[];
  readonly boneyardDrawable: readonly Tile[];
  readonly boneyardDead: readonly Tile[];
};

/**
 * B1 (game-review-oracle-upgrade-2026-09-13.md): deterministic hidden-allocation
 * sampler. Given a real ReviewPositionSnapshotV2 and a seed, produces one
 * plausible full allocation of every currently-hidden tile (opponent's hand +
 * boneyard, both drawable and dead) that is consistent with the snapshot's
 * public counts and knownMissingPipEvidence. Pure and seeded: same
 * (snapshot, seed) always yields the same result, including a stable `null`
 * when the constraints are infeasible (see issue #220 for why infeasibility
 * can happen in practice: evidence is never invalidated after a further
 * opponent draw, so accumulated exclusions can outpace the remaining pool
 * late in a hand).
 *
 * maxPips defaults to 6 because ReviewPositionSnapshotV2 does not carry the
 * game's Config (checked directly — it isn't there), and every real config in
 * this codebase uses 6 (checked via a repo-wide search — no other value is
 * ever set). Accepted as a parameter rather than hardcoded so a future
 * non-default config doesn't silently produce a wrong-sized universe.
 */
export function sampleHiddenAllocation(
  snapshot: ReviewPositionSnapshotV2,
  seed: string | number,
  maxPips = 6,
): ReviewHiddenAllocation | null {
  const { actorHand, board, opponentTileCount, boneyard, knownMissingPipEvidence } = snapshot.preAction;

  // generateFullSet iterates two plain nested for-loops over fixed numeric
  // ranges (packages/game-core/src/types.ts) — not Set/object-keyed, so its
  // order is fixed and reproducible for a given maxPips. tilesOnBoard walks
  // mainLine then each hub's branches in array order (also game-core). The
  // two `.filter` calls below preserve the relative order of `generateFullSet`'s
  // output for every tile they keep (Array.prototype.filter is
  // order-preserving by spec) — so `hiddenPool` is deterministic before any
  // seeded shuffle is applied to it.
  const knownTiles = [...actorHand, ...tilesOnBoard(board)];
  const hiddenPool = generateFullSet(maxPips).filter(
    (tile) => !knownTiles.some((known) => tileEquals(known, tile)),
  );

  const excludedPips = new Set(knownMissingPipEvidence.map((evidence) => evidence.pip));
  const isEligibleForOpponent = (tile: Tile) => !excludedPips.has(tile.low) && !excludedPips.has(tile.high);
  const eligibleForOpponent = hiddenPool.filter(isEligibleForOpponent);
  const boneyardOnly = hiddenPool.filter((tile) => !isEligibleForOpponent(tile));

  // Single RNG instance, consumed sequentially across both shuffles below —
  // not reseeded partway through.
  const random = createDeterministicRandom(seed);

  const shuffledEligible = shuffleDeterministically(eligibleForOpponent, random);
  if (shuffledEligible.length < opponentTileCount) {
    // Infeasible: fewer evidence-consistent tiles remain than the opponent's
    // hand needs. Deterministic for this (snapshot, seed) pair — every seed
    // sees the same hiddenPool/eligible split, only the shuffle order differs,
    // and the split itself is what's infeasible here, not the shuffle.
    return null;
  }
  const opponentHand = shuffledEligible.slice(0, opponentTileCount);
  const leftoverEligible = shuffledEligible.slice(opponentTileCount);

  const remainingPool = shuffleDeterministically([...leftoverEligible, ...boneyardOnly], random);
  const { drawableCount, deadCount } = boneyard;
  if (remainingPool.length !== drawableCount + deadCount) {
    // Not a legitimate infeasibility case (that's handled above) — this would
    // mean the snapshot's own counts don't add up, a bug in the input, not a
    // real "the opponent might have any of several hands" situation.
    throw new Error(
      `sampleHiddenAllocation: arithmetic invariant violated — remaining pool has ${remainingPool.length} tiles ` +
        `but boneyard.drawableCount + boneyard.deadCount = ${drawableCount + deadCount}.`,
    );
  }

  return {
    opponentHand,
    boneyardDrawable: remainingPool.slice(0, drawableCount),
    boneyardDead: remainingPool.slice(drawableCount),
  };
}
