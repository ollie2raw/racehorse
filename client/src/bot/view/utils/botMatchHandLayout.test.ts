import { describe, expect, it } from 'vitest';
import type { Tile } from '../../../types.ts';
import { computeNormalHandRows } from './botMatchHandLayout.ts';

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
});