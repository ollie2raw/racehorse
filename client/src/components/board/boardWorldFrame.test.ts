import { describe, expect, it } from 'vitest';
import type { BoardState } from '../../types.ts';
import { playGame, VARIANTS, type Policy } from '../../../../packages/game-core/src/__tests__/support/engineHarness';
import { advanceWorldOrigin, boundsCenter, commonDisplacement } from './boardWorldFrame.ts';
import { computeBoardLayout, type BoardLayout } from './boardLayout.ts';
import { countBoardTiles, countReflowed, layoutOptionsFor, VIEWPORT_PROFILES } from './boardQualityMetrics.ts';

const tile = (key: string, x: number, y: number) => ({ tile: { low: 1, high: 2 }, x, y, rotation: 0, flipped: false, key });
const layoutOf = (tiles: ReturnType<typeof tile>[]): Pick<BoardLayout, 'tiles' | 'minX' | 'maxX' | 'minY' | 'maxY'> => ({
  tiles,
  minX: Math.min(...tiles.map((t) => t.x)) - 2.5,
  maxX: Math.max(...tiles.map((t) => t.x)) + 2.5,
  minY: Math.min(...tiles.map((t) => t.y)) - 2.5,
  maxY: Math.max(...tiles.map((t) => t.y)) + 2.5,
});

describe('world frame', () => {
  it('commonDisplacement is the shift most surviving tiles share, ignoring a tile that really moved', () => {
    const before = layoutOf([tile('a', 0, 0), tile('b', 2, 0), tile('c', 4, 0)]);
    const after = layoutOf([tile('a', 1, 0), tile('b', 3, 0), tile('c', 5, 3), tile('d', -1, 0)]);
    expect(commonDisplacement(before, after)).toEqual({ x: 1, y: 0 });
  });

  it('is null when nothing survives', () => {
    expect(commonDisplacement(layoutOf([tile('a', 0, 0)]), layoutOf([tile('z', 5, 5)]))).toBeNull();
  });

  it('keeps a placed tile at the same world position when a tile is added at the left', () => {
    const before = layoutOf([tile('a', 0, 0), tile('b', 2, 0)]);
    const origin0 = boundsCenter(before);
    // A tile is added on the left; the engine re-anchors the main line, shifting everything +2.
    const after = layoutOf([tile('n', 0, 0), tile('a', 2, 0), tile('b', 4, 0)]);
    const origin1 = advanceWorldOrigin(before, origin0, after);
    const worldBefore = { x: 0 - origin0.x, y: 0 - origin0.y }; // tile a
    const worldAfter = { x: 2 - origin1.x, y: 0 - origin1.y };
    expect(worldAfter).toEqual(worldBefore);
  });

  it('starts at the bounds centre when no tile survives (first tile of a hand)', () => {
    const next = layoutOf([tile('a', 0, 0)]);
    expect(advanceWorldOrigin(layoutOf([tile('z', 9, 9)]), { x: 9, y: 9 }, next)).toEqual(boundsCenter(next));
  });
});

// ─── corpus: placed tiles never move in the world frame ──────────

const POLICIES: Policy[] = ['random', 'scoreGreedy', 'doubles', 'branch'];

describe('world frame on real games', () => {
  it('leaves every placed tile where it was, except tiles the router genuinely moved', () => {
    let steps = 0;
    let moved = 0;
    let reflowed = 0;
    for (const profile of [VIEWPORT_PROFILES[0], VIEWPORT_PROFILES[3]]) {
      const options = layoutOptionsFor(profile);
      for (const policy of POLICIES) {
        for (let g = 0; g < 3; g += 1) {
          const run = playGame(`world-frame-v1:${policy}:${g}`, VARIANTS[0], policy, { keepStates: true });
          let prev: BoardLayout | null = null;
          let origin = { x: 0, y: 0 };
          let lastCount = 0;
          for (const state of run.states) {
            const board = state.board as unknown as BoardState | null;
            const count = countBoardTiles(board);
            if (count < lastCount) prev = null; // new hand
            lastCount = count;
            if (!board || count === 0) continue;
            const layout = computeBoardLayout(board, [], options);
            if (!prev) {
              origin = boundsCenter(layout);
            } else if (count > lastCountOf(prev)) {
              const next = advanceWorldOrigin(prev, origin, layout);
              const old = new Map(prev.tiles.map((t) => [t.key, t]));
              for (const t of layout.tiles) {
                const was = old.get(t.key);
                if (!was) continue;
                const dx = t.x - next.x - (was.x - origin.x);
                const dy = t.y - next.y - (was.y - origin.y);
                if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) moved += 1;
              }
              reflowed += countReflowed(prev, layout);
              origin = next;
              steps += 1;
            } else {
              continue;
            }
            prev = layout;
          }
        }
      }
    }
    expect(steps).toBeGreaterThan(200);
    // A tile moves in the world frame only if routing moved it (re-routes), never because of recentring.
    expect(moved).toBeLessThanOrEqual(reflowed);
  });
});

function lastCountOf(layout: BoardLayout): number {
  return layout.tiles.length;
}
