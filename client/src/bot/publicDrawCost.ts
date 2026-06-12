import type { Tile } from '../types.ts';

/** Tiles drawable from boneyard (excludes locked tail). Public info only. */
export function drawableBoneyardCount(boneyardLength: number, lockedCount = 2): number {
  return Math.max(0, boneyardLength - lockedCount);
}

/**
 * Estimate draw penalty using only public information: open ends, bot hand after move,
 * unseen tile multiset (opponent rack + boneyard, no order), and drawable boneyard count.
 * Must not depend on boneyard stack order.
 */
export function estimateDrawCostFromPublicInfo(
  nextHand: readonly Tile[],
  openEnds: readonly number[],
  unseenPool: readonly Tile[],
  boneyardDrawableCount: number,
): number {
  const endSet = new Set(openEnds);
  const playableAfter = nextHand.filter((t) => endSet.has(t.low) || endSet.has(t.high)).length;
  if (playableAfter > 0) return 0;
  if (boneyardDrawableCount <= 0) return 15;

  const playableInUnseen = unseenPool.filter((t) => endSet.has(t.low) || endSet.has(t.high)).length;
  if (playableInUnseen === 0) return 20;

  const pPlayable = playableInUnseen / Math.max(1, unseenPool.length);
  const expectedDraws = Math.min(boneyardDrawableCount, 1 / Math.max(0.01, pPlayable));
  const avgPip =
    unseenPool.length > 0
      ? unseenPool.reduce((s, t) => s + t.low + t.high, 0) / unseenPool.length
      : 6;

  return Math.min(expectedDraws * avgPip * 0.4, 25);
}
