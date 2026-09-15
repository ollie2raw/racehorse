import { describe, expect, it } from 'vitest';
import { enumerateCombinations } from '../combinations';

describe('enumerateCombinations', () => {
  it('enumerates all size-2 combinations of a 4-item array in fixed lexicographic index order', () => {
    const result = enumerateCombinations(['a', 'b', 'c', 'd'], 2);
    expect(result).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['a', 'd'],
      ['b', 'c'],
      ['b', 'd'],
      ['c', 'd'],
    ]);
  });

  it('returns a single combination equal to the whole array when size equals the array length', () => {
    const result = enumerateCombinations([1, 2, 3], 3);
    expect(result).toEqual([[1, 2, 3]]);
  });

  it('returns one empty combination when size is 0', () => {
    const result = enumerateCombinations([1, 2, 3], 0);
    expect(result).toEqual([[]]);
  });

  it('returns no combinations when size exceeds the array length', () => {
    const result = enumerateCombinations([1, 2], 3);
    expect(result).toEqual([]);
  });

  it('produces exactly C(n,k) combinations with no duplicates, for a larger set', () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const result = enumerateCombinations(items, 3);
    // C(10,3) = 120
    expect(result).toHaveLength(120);
    const keys = new Set(result.map((combo) => combo.join(',')));
    expect(keys.size).toBe(120);
  });
});
