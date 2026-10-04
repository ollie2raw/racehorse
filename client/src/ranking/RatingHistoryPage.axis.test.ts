import { describe, expect, it } from 'vitest';
import { ratingAxisDomain } from './RatingHistoryPage';

describe('ratingAxisDomain', () => {
  it('spans the confidence band, not zero', () => {
    // rating 1500 ± 80, rating 1620 ± 60
    expect(ratingAxisDomain([{ lower: 1420, band: 160 }, { lower: 1560, band: 120 }])).toEqual([1400, 1700]);
  });

  it('is a flat placeholder with no games', () => {
    expect(ratingAxisDomain([])).toEqual([0, 0]);
  });
});
