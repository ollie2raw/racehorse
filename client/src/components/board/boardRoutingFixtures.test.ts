import { describe, expect, it } from 'vitest';
import { FIXTURES, armSteps, spinnerWithArms, type FixtureName } from './boardRoutingFixtures.ts';
import { computeBoardLayout } from './boardLayout.ts';

describe('boardRoutingFixtures', () => {
  for (const name of Object.keys(FIXTURES) as FixtureName[]) {
    it(`${name} builds deterministically through real placement`, () => {
      const a = FIXTURES[name]();
      const b = FIXTURES[name]();
      expect(a).toEqual(b);
      expect(computeBoardLayout(a).tiles.length).toBeGreaterThan(0);
    });
  }

  it('places a double exactly where asked and keeps it a registered hub', () => {
    const board = spinnerWithArms({ up: armSteps(7, [3]) });
    const arm = board.hubDoubles[0].branches[0]!;
    expect(arm.tiles).toHaveLength(7);
    expect(arm.tiles[3].tile.low).toBe(arm.tiles[3].tile.high);
    expect(board.hubDoubles.some((h) => h.laneType === 'branch' && h.branchDepth === 3)).toBe(true);
  });
});
