import { describe, expect, it } from 'vitest';
import { countCombinations, enumerateCombinations, enumerateCombinationsLazy } from '../combinations';

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

describe('enumerateCombinationsLazy', () => {
  it('yields exactly the same sequence, in the same order, as enumerateCombinations', () => {
    const items = Array.from({ length: 8 }, (_, i) => i);
    for (const size of [0, 1, 3, 8, 9]) {
      expect(Array.from(enumerateCombinationsLazy(items, size))).toEqual(enumerateCombinations(items, size));
    }
  });

  it('can be stopped early without generating remaining combinations', () => {
    const items = Array.from({ length: 6 }, (_, i) => i);
    const seen: number[][] = [];
    for (const combo of enumerateCombinationsLazy(items, 2)) {
      seen.push([...combo]);
      if (seen.length === 2) break;
    }
    expect(seen).toEqual([
      [0, 1],
      [0, 2],
    ]);
  });
});

describe('countCombinations', () => {
  it('matches C(n,k) for known small values', () => {
    expect(countCombinations(4, 2)).toBe(6);
    expect(countCombinations(10, 3)).toBe(120);
    expect(countCombinations(28, 7)).toBe(1184040);
  });

  it('agrees with enumerateCombinations.length across a range of n/k', () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    for (let k = 0; k <= 12; k += 1) {
      expect(countCombinations(12, k)).toBe(enumerateCombinations(items, k).length);
    }
  });

  it('returns 0 for out-of-range k (negative or greater than n)', () => {
    expect(countCombinations(5, -1)).toBe(0);
    expect(countCombinations(5, 6)).toBe(0);
  });

  it('returns 1 for k === 0 and k === n', () => {
    expect(countCombinations(7, 0)).toBe(1);
    expect(countCombinations(7, 7)).toBe(1);
  });
});
