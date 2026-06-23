import { describe, it, expect } from 'vitest';
import { tileListEquals, getBoardEnds, getBoardTileCount } from './boardSessionUtils';

describe('tileListEquals', () => {
  it('returns true for two empty lists', () => {
    expect(tileListEquals([], [])).toBe(true);
  });
  it('returns false for lists of different length', () => {
    expect(tileListEquals([{ low: 1, high: 2 }], [])).toBe(false);
  });
  it('returns true for identical lists', () => {
    const tiles = [{ low: 1, high: 2 }, { low: 3, high: 4 }];
    expect(tileListEquals(tiles, tiles)).toBe(true);
  });
  it('returns false for lists with different tiles', () => {
    expect(tileListEquals([{ low: 1, high: 2 }], [{ low: 1, high: 3 }])).toBe(false);
  });
});

describe('getBoardEnds', () => {
  it('returns [-1, -1] for null board', () => {
    expect(getBoardEnds(null)).toEqual([-1, -1]);
  });
  it('returns [-1, -1] for undefined board', () => {
    expect(getBoardEnds(undefined)).toEqual([-1, -1]);
  });
});

describe('getBoardTileCount', () => {
  it('returns 0 for empty board', () => {
    const emptyBoard = { mainLine: [], hubDoubles: [], leftEnd: -1, rightEnd: -1, leftEndIsDouble: false, rightEndIsDouble: false };
    expect(getBoardTileCount(emptyBoard)).toBe(0);
  });
});
