import { describe, it, expect } from 'vitest';
import { computeGoOutBonusPoints, computeHandPenalty } from '../scoring';
import { DEFAULT_CONFIG, type Config } from '../types';

describe('end-of-hand bonus/penalty honor a scoringMultiple override', () => {
  // Sum of pips = 4 + 3 = 7. Under the default scoringMultiple (5),
  // Math.round(7 / 5) = 1. Under a scoringMultiple of 1, it must be 7.
  const hand = [
    { high: 4, low: 0 },
    { high: 3, low: 0 },
  ];
  const overrideConfig: Config = { ...DEFAULT_CONFIG, scoringMultiple: 1 };

  it('computeHandPenalty rounds using the given scoringMultiple, not a hardcoded 5', () => {
    expect(computeHandPenalty(hand, DEFAULT_CONFIG)).toBe(1);
    expect(computeHandPenalty(hand, overrideConfig)).toBe(7);
  });

  it('computeGoOutBonusPoints rounds using the given scoringMultiple, not a hardcoded 5', () => {
    expect(computeGoOutBonusPoints(hand, DEFAULT_CONFIG)).toBe(1);
    expect(computeGoOutBonusPoints(hand, overrideConfig)).toBe(7);
  });
});
