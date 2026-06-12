import { estimateDrawCostFromPublicInfo } from './publicDrawCost.ts';
import type { Tile } from '../types.ts';

const t = (low: number, high: number): Tile => ({ low, high });

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`[publicDrawCost.behaviorTests] ${msg}`);
}

export function runPublicDrawCostBehaviorTests(): void {
  const nextHand = [t(0, 1)];
  const openEnds = [3, 4];
  const pool = [t(3, 5), t(4, 6), t(0, 2), t(1, 1)];
  const a = estimateDrawCostFromPublicInfo(nextHand, openEnds, pool, 8);
  const b = estimateDrawCostFromPublicInfo(nextHand, openEnds, [...pool].reverse(), 8);
  assert(a === b, 'draw cost must not depend on unseen pool order');

  const playable = estimateDrawCostFromPublicInfo([t(2, 5)], [2, 5], pool, 8);
  assert(playable === 0, 'playable hand should have zero draw cost');
  console.log('[publicDrawCost.behaviorTests] passed');
}
