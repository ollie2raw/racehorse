// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Tile } from '../../../types.ts';
import { computeNormalHandRows } from './botMatchHandLayout.ts';
import { compactSingleRowLimit } from '../../../match/compactLandscape.ts';

const tiles = (count: number): Tile[] =>
  Array.from({ length: count }, (_, index) => ({ low: index % 7, high: (index + 1) % 7 }));

describe('computeNormalHandRows', () => {
  it('keeps a single row for seven tiles on desktop', () => {
    expect(
      computeNormalHandRows(tiles(7), {
        isLessonLayoutMode: false,
        lessonHandRowCount: 1,
        isMobileViewport: false,
      }),
    ).toHaveLength(1);
  });

  it('splits large hands into two rows', () => {
    const rows = computeNormalHandRows(tiles(10), {
      isLessonLayoutMode: false,
      lessonHandRowCount: 1,
      isMobileViewport: false,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(5);
    expect(rows[1]).toHaveLength(5);
  });

  it('splits lesson layout hands when lessonHandRowCount > 1', () => {
    const hand = tiles(6);
    const rows = computeNormalHandRows(hand, {
      isLessonLayoutMode: true,
      lessonHandRowCount: 2,
      isMobileViewport: false,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(3);
    expect(rows[1]).toHaveLength(3);
  });

  it('splits from 9 tiles on a short landscape viewport (phone sideways), keeps 8 on one row', () => {
    const opts = { isLessonLayoutMode: false, lessonHandRowCount: 1, isMobileViewport: false, isShortLandscape: true };
    expect(computeNormalHandRows(tiles(8), opts)).toHaveLength(1);
    const rows = computeNormalHandRows(tiles(9), opts);
    expect(rows.map((r) => r.length)).toEqual([5, 4]);
  });

  it('keeps 9 tiles on one row on a normal viewport', () => {
    const opts = { isLessonLayoutMode: false, lessonHandRowCount: 1, isMobileViewport: false };
    expect(computeNormalHandRows(tiles(9), opts)).toHaveLength(1);
  });

  it('compact landscape: a measured single-row limit replaces the fixed 8 (667px fits 7 tiles, 740px fits 8)', () => {
    const base = { isLessonLayoutMode: false, lessonHandRowCount: 1, isMobileViewport: false, isShortLandscape: true };
    const limit = (width: number) => compactSingleRowLimit(width, true)!;
    expect(limit(667)).toBe(7);
    expect(limit(740)).toBe(8);
    expect(computeNormalHandRows(tiles(7), { ...base, maxSingleRow: limit(667) })).toHaveLength(1);
    expect(computeNormalHandRows(tiles(8), { ...base, maxSingleRow: limit(667) }).map((r) => r.length)).toEqual([4, 4]);
    expect(computeNormalHandRows(tiles(8), { ...base, maxSingleRow: limit(740) })).toHaveLength(1);
    expect(computeNormalHandRows(tiles(9), { ...base, maxSingleRow: limit(740) }).map((r) => r.length)).toEqual([5, 4]);
  });
});
