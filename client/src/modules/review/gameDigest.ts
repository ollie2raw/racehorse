import { fnv1a32Hex } from '@racehorse/game-core/review';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';

export const GAME_DIGEST_VERSION = 1 as const;

/**
 * E1 (docs/scoping/game-review-oracle-upgrade-2026-09-13.md, Phase E): a
 * whole-game content-addressing digest for game_reviews persistence's
 * `gameDigest` field. Hashes the full ORDERED array of each decision's
 * `integrity.authorityPostStateDigest` -- not just the final one -- so two
 * games that happen to reach the same terminal board state via different
 * move sequences produce different digests. The single-final-snapshot
 * alternative was flagged during E1's own investigation as a real, avoidable
 * collision risk; this is the safer choice.
 *
 * Reuses `fnv1a32Hex`, the exact same hash primitive
 * `getReviewAuthorityStateDigest` itself uses (reviewContracts.ts), for
 * consistency -- not a second hand-copied hash implementation.
 */
export function computeGameDigest(snapshots: readonly ReviewPositionSnapshotV2[]): string {
  const serialized = snapshots.map((snapshot) => snapshot.integrity.authorityPostStateDigest).join('\n');
  return `game-digest-v${GAME_DIGEST_VERSION}:${fnv1a32Hex(serialized)}`;
}
