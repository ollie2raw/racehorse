import { describe, it, expect } from 'vitest';
import { tileListEquals, getBoardEnds, getBoardTileCount, findPlacedTile } from './boardSessionUtils';

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

  // --- NEW CASES ---
  it('returns false for lists with same tiles but in different order', () => {
    const listA = [{ low: 1, high: 2 }, { low: 3, high: 4 }];
    const listB = [{ low: 3, high: 4 }, { low: 1, high: 2 }];
    expect(tileListEquals(listA, listB)).toBe(false);
  });

  it('returns true for identical lists with duplicate tiles', () => {
    const listA = [{ low: 1, high: 2 }, { low: 1, high: 2 }, { low: 3, high: 4 }];
    const listB = [{ low: 1, high: 2 }, { low: 1, high: 2 }, { low: 3, high: 4 }];
    expect(tileListEquals(listA, listB)).toBe(true);
  });

  it('returns false for lists with different duplicate tile counts', () => {
    const listA = [{ low: 1, high: 2 }, { low: 3, high: 4 }];
    const listB = [{ low: 1, high: 2 }, { low: 3, high: 4 }, { low: 3, high: 4 }];
    expect(tileListEquals(listA, listB)).toBe(false);
  });
});

describe('getBoardEnds', () => {
  it('returns [-1, -1] for null board', () => {
    expect(getBoardEnds(null)).toEqual([-1, -1]);
  });

  it('returns [-1, -1] for undefined board', () => {
    expect(getBoardEnds(undefined)).toEqual([-1, -1]);
  });

  // --- NEW CASES ---
  it('returns actual left and right ends for a valid board state', () => {
    const board = {
      leftEnd: 5,
      rightEnd: 3,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      mainLine: [],
      hubDoubles: [],
    };
    expect(getBoardEnds(board as any)).toEqual([5, 3]);
  });

  it('returns actual ends when left and right are identical', () => {
    const board = {
      leftEnd: 6,
      rightEnd: 6,
      leftEndIsDouble: true,
      rightEndIsDouble: true,
      mainLine: [],
      hubDoubles: [],
    };
    expect(getBoardEnds(board as any)).toEqual([6, 6]);
  });
});

describe('getBoardTileCount', () => {
  it('returns 0 for empty board', () => {
    const emptyBoard = { mainLine: [], hubDoubles: [], leftEnd: -1, rightEnd: -1, leftEndIsDouble: false, rightEndIsDouble: false };
    expect(getBoardTileCount(emptyBoard as any)).toBe(0);
  });

  // --- NEW CASES ---
  it('returns correct count for tiles on the mainLine', () => {
    const board = {
      leftEnd: 1,
      rightEnd: 2,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      mainLine: [
        { tile: { low: 1, high: 1 }, side: 'left' as const },
        { tile: { low: 1, high: 2 }, side: 'right' as const },
      ],
      hubDoubles: [],
    };
    expect(getBoardTileCount(board as any)).toBe(2);
  });

  it('returns correct count when hubDoubles and branches have tiles', () => {
    const board = {
      leftEnd: 1,
      rightEnd: 2,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      mainLine: [{ tile: { low: 5, high: 5 }, side: 'left' as const }],
      hubDoubles: [
        {
          tile: { low: 5, high: 5 },
          branches: [
            {
              branchIndex: 0,
              tiles: [{ tile: { low: 5, high: 1 }, side: 'left' as const }],
            },
            {
              branchIndex: 1,
              tiles: [
                { tile: { low: 5, high: 2 }, side: 'right' as const },
                { tile: { low: 2, high: 3 }, side: 'right' as const },
              ],
            },
          ],
        },
      ],
    };
    // 1 on mainLine, 1 in branch 0, 2 in branch 1 = 4 total
    expect(getBoardTileCount(board as any)).toBe(4);
  });

  it('handles null/undefined fields in branches and mainLine gracefully', () => {
    const board = {
      leftEnd: 1,
      rightEnd: 2,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      mainLine: [null as any],
      hubDoubles: [
        {
          tile: { low: 5, high: 5 },
          branches: [
            {
              branchIndex: 0,
              tiles: [null as any],
            },
          ],
        },
      ],
    };
    // The function counts array lengths directly without filtering null elements, but does not throw.
    expect(getBoardTileCount(board as any)).toBe(2);
  });
});

describe('findPlacedTile', () => {
  const emptyBoard = {
    leftEnd: -1,
    rightEnd: -1,
    leftEndIsDouble: false,
    rightEndIsDouble: false,
    mainLine: [],
    hubDoubles: [],
  };

  it('1. returns null when boards are identical and empty', () => {
    expect(findPlacedTile(emptyBoard as any, emptyBoard as any)).toBeNull();
  });

  it('2. returns newly placed tile on mainLine', () => {
    const prevBoard = emptyBoard;
    const nextBoard = {
      ...emptyBoard,
      mainLine: [{ tile: { low: 4, high: 4 }, side: 'left' as const }],
    };
    expect(findPlacedTile(prevBoard as any, nextBoard as any)).toEqual({ low: 4, high: 4 });
  });

  it('3. returns null when board states have identical tiles', () => {
    const prevBoard = {
      ...emptyBoard,
      mainLine: [{ tile: { low: 4, high: 4 }, side: 'left' as const }],
    };
    const nextBoard = {
      ...emptyBoard,
      mainLine: [{ tile: { low: 4, high: 4 }, side: 'left' as const }],
    };
    expect(findPlacedTile(prevBoard as any, nextBoard as any)).toBeNull();
  });

  it('4. finds newly placed duplicate tile when previous already had one of them', () => {
    const prevBoard = {
      ...emptyBoard,
      mainLine: [{ tile: { low: 4, high: 4 }, side: 'left' as const }],
    };
    const nextBoard = {
      ...emptyBoard,
      mainLine: [
        { tile: { low: 4, high: 4 }, side: 'left' as const },
        { tile: { low: 4, high: 4 }, side: 'right' as const },
      ],
    };
    expect(findPlacedTile(prevBoard as any, nextBoard as any)).toEqual({ low: 4, high: 4 });
  });

  it('5. returns newly placed tile inside a hub double branch', () => {
    const prevBoard = {
      ...emptyBoard,
      mainLine: [{ tile: { low: 5, high: 5 }, side: 'left' as const }],
      hubDoubles: [
        {
          tile: { low: 5, high: 5 },
          branches: [
            {
              branchIndex: 0,
              tiles: [],
            },
          ],
        },
      ],
    };
    const nextBoard = {
      ...emptyBoard,
      mainLine: [{ tile: { low: 5, high: 5 }, side: 'left' as const }],
      hubDoubles: [
        {
          tile: { low: 5, high: 5 },
          branches: [
            {
              branchIndex: 0,
              tiles: [{ tile: { low: 5, high: 2 }, side: 'left' as const }],
            },
          ],
        },
      ],
    };
    expect(findPlacedTile(prevBoard as any, nextBoard as any)).toEqual({ low: 5, high: 2 });
  });

  it('6. ignores null/undefined tile placements gracefully', () => {
    const prevBoard = emptyBoard;
    const nextBoard = {
      ...emptyBoard,
      mainLine: [null as any],
    };
    expect(findPlacedTile(prevBoard as any, nextBoard as any)).toBeNull();
  });
});
