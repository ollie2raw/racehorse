// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { collectPhysicalTilesFromBoard } from './journeyBoardAnalysis.ts';
import type { BoardState } from '../types.ts';

const placed = (low: number, high: number) => ({ tile: { low, high }, orientation: 'horizontal-normal' as const });
const board = (hubDoubles: BoardState['hubDoubles'] = []): BoardState => ({ mainLine: [placed(1, 2), placed(2, 2)], leftEnd: 1, rightEnd: 2, leftEndIsDouble: false, rightEndIsDouble: true, hubDoubles });

describe('Journey physical board tile enumeration', () => {
  it('collects mainline and open doubles once', () => {
    expect(collectPhysicalTilesFromBoard(board())).toHaveLength(2);
  });
  it('collects both populated crossed-double branch arms', () => {
    const value = board([{ hubId: 7, tileIndex: 1, hubValue: 2, isCrossed: true, branches: [{ openEnd: 3, openEndIsDouble: false, tiles: [placed(2, 3)] }, { openEnd: 4, openEndIsDouble: false, tiles: [placed(2, 4)] }] }]);
    expect(collectPhysicalTilesFromBoard(value).map((tile) => `${tile.low}-${tile.high}`)).toEqual(['1-2', '2-2', '2-3', '2-4']);
  });
  it('rejects duplicate physical tiles and leaves the board unchanged', () => {
    const value = board();
    const before = JSON.stringify(value);
    expect(() => collectPhysicalTilesFromBoard({ ...value, hubDoubles: [{ hubId: 1, tileIndex: 1, hubValue: 2, isCrossed: true, branches: [{ openEnd: 3, openEndIsDouble: false, tiles: [placed(1, 2)] }, null] }] })).toThrow('Duplicate physical board tile');
    expect(JSON.stringify(value)).toBe(before);
  });
});
