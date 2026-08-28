import { describe, it, expect } from 'vitest';
import { buildShareGridRow, pointsShare, SHARE_GRID_WIDTH } from './shareGrid';

const cells = (row: string) => [...row].length;

describe('buildShareGridRow', () => {
  it('is always the same width, whatever the result', () => {
    for (const row of [
      buildShareGridRow(0.66, 'win'),
      buildShareGridRow(1, 'skunk'),
      buildShareGridRow(0, 'loss'),
      buildShareGridRow(null, 'none'),
    ]) {
      expect(cells(row)).toBe(SHARE_GRID_WIDTH);
    }
  });

  it('fills by share of points', () => {
    expect(buildShareGridRow(0.66, 'win')).toBe('🟩🟩🟩🟩🟩🟩🟩⬛⬛⬛');
    expect(buildShareGridRow(0.83, 'skunk')).toBe('🟨🟨🟨🟨🟨🟨🟨🟨⬛⬛');
  });

  it('marks an unplayed row rather than an empty one', () => {
    expect(buildShareGridRow(null, 'none')).toBe('⬜'.repeat(SHARE_GRID_WIDTH));
    // A played row scoring nothing is black, not white — it was contested.
    expect(buildShareGridRow(0, 'loss')).toBe('⬛'.repeat(SHARE_GRID_WIDTH));
  });

  it('keeps a narrow result visible', () => {
    // 3% would round to zero cells and read as unplayed.
    expect(buildShareGridRow(0.03, 'loss').startsWith('🟥')).toBe(true);
  });

  it('never overflows on a lopsided score', () => {
    expect(cells(buildShareGridRow(1.4, 'win'))).toBe(SHARE_GRID_WIDTH);
  });
});

describe('pointsShare', () => {
  it('is the player’s share of the points scored', () => {
    expect(pointsShare(65, 33)).toBeCloseTo(0.663, 2);
    expect(pointsShare(60, 12)).toBeCloseTo(0.833, 2);
  });

  it('is zero for a scoreless game rather than NaN', () => {
    expect(pointsShare(0, 0)).toBe(0);
  });
});
