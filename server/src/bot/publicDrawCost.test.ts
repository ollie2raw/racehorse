import { describe, expect, it } from 'vitest';
import { estimateDrawCostFromPublicInfo } from './publicDrawCost';
import type { Tile } from '../game/types';

const t = (low: number, high: number): Tile => ({ low, high });

describe('estimateDrawCostFromPublicInfo', () => {
  it('returns 0 when the bot hand already has a playable tile', () => {
    const cost = estimateDrawCostFromPublicInfo(
      [t(2, 5)],
      [2, 5],
      [t(0, 1), t(3, 4)],
      10,
    );
    expect(cost).toBe(0);
  });

  it('is invariant to unseen pool order (no boneyard stack oracle)', () => {
    const nextHand = [t(0, 1)];
    const openEnds = [3, 4];
    const poolA = [t(3, 5), t(4, 6), t(0, 2), t(1, 1)];
    const poolB = [...poolA].reverse();
    const a = estimateDrawCostFromPublicInfo(nextHand, openEnds, poolA, 8);
    const b = estimateDrawCostFromPublicInfo(nextHand, openEnds, poolB, 8);
    expect(a).toBe(b);
  });

  it('is invariant to boneyard tile order when count is fixed', () => {
    const nextHand = [t(0, 1)];
    const openEnds = [5];
    const pool = [t(5, 6), t(2, 3), t(4, 4), t(1, 2)];
    const cost = estimateDrawCostFromPublicInfo(nextHand, openEnds, pool, 6);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBe(estimateDrawCostFromPublicInfo(nextHand, openEnds, [...pool].reverse(), 6));
  });
});
