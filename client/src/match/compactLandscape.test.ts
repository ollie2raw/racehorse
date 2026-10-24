import { describe, expect, it } from 'vitest';
import { COMPACT_LANDSCAPE_BELOW_WIDTH, compactSingleRowLimit } from './compactLandscape';

describe('compactSingleRowLimit (rack tiles per row on compact iPhone landscape)', () => {
  it('only applies to short landscape below the 844px layout', () => {
    expect(compactSingleRowLimit(667, false)).toBeUndefined();
    expect(compactSingleRowLimit(COMPACT_LANDSCAPE_BELOW_WIDTH, true)).toBeUndefined();
    expect(compactSingleRowLimit(932, true)).toBeUndefined();
  });

  it('fits whole 75px tiles with 10px gaps inside a width minus the 60px layout+deck inset', () => {
    // iPhone SE/8 (667): 607px interior -> 7 tiles (7*75 + 6*10 = 585); an 8th (670) would not fit
    expect(compactSingleRowLimit(667, true)).toBe(7);
    // 740 -> 680 interior -> 8 tiles (8*75 + 7*10 = 670)
    expect(compactSingleRowLimit(740, true)).toBe(8);
    // iPhone 12/13 mini (812) -> 752 interior -> 8 (9 tiles would need 765)
    expect(compactSingleRowLimit(812, true)).toBe(8);
  });

  it('never goes below five per row on very narrow widths', () => {
    expect(compactSingleRowLimit(320, true)).toBe(5);
  });

  it('is monotonic: a wider screen never fits fewer tiles', () => {
    let last = 0;
    for (let w = 560; w < COMPACT_LANDSCAPE_BELOW_WIDTH; w += 4) {
      const v = compactSingleRowLimit(w, true)!;
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });
});
