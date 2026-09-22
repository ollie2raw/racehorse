/**
 * Enumerates every size-`size` combination of `items` in fixed lexicographic
 * index order: the standard "next combination" walk over ascending index
 * tuples (0,1,...,size-1), (0,1,...,size-2,size), etc. Callers that need a
 * canonical, seed-independent enumeration order (B2's solveExactEndgame) must
 * sort `items` into their own canonical order before calling this — this
 * helper only fixes the order of *index* tuples, not of `items` itself.
 */
export function enumerateCombinations<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  return Array.from(enumerateCombinationsLazy(items, size));
}

/**
 * Same fixed lexicographic index-tuple walk as `enumerateCombinations`, but
 * yielding one combination at a time. Used by solveExactEndgame's wall-clock
 * ceiling so elapsed time can be checked between allocations instead of only
 * after an eager full materialization (itself an unbounded-time hazard for
 * large hidden pools). Sequence and order match `enumerateCombinations`.
 */
export function* enumerateCombinationsLazy<T>(
  items: readonly T[],
  size: number,
): Generator<readonly T[], void, void> {
  if (size < 0 || size > items.length) return;
  if (size === 0) {
    yield [];
    return;
  }

  const indices = Array.from({ length: size }, (_, i) => i);

  while (true) {
    yield indices.map((index) => items[index]);

    let pivot = size - 1;
    while (pivot >= 0 && indices[pivot] === items.length - size + pivot) {
      pivot -= 1;
    }
    if (pivot < 0) break;

    indices[pivot] += 1;
    for (let i = pivot + 1; i < size; i += 1) {
      indices[i] = indices[i - 1] + 1;
    }
  }
}

/**
 * n-choose-k without materializing combinations. Lets solveExactEndgame know
 * the true allocation count for `coverage` without paying the enumeration
 * cost the wall-clock ceiling exists to bound. Returns 0 for out-of-range
 * size (matching the empty-result convention of the enumerators).
 */
export function countCombinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const bound = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < bound; i += 1) {
    result = (result * (n - i)) / (i + 1);
  }
  return Math.round(result);
}
