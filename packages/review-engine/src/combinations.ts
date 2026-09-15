/**
 * Enumerates every size-`size` combination of `items` in fixed lexicographic
 * index order: the standard "next combination" walk over ascending index
 * tuples (0,1,...,size-1), (0,1,...,size-2,size), etc. Callers that need a
 * canonical, seed-independent enumeration order (B2's solveExactEndgame) must
 * sort `items` into their own canonical order before calling this — this
 * helper only fixes the order of *index* tuples, not of `items` itself.
 */
export function enumerateCombinations<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  if (size < 0 || size > items.length) return [];
  if (size === 0) return [[]];

  const combinations: T[][] = [];
  const indices = Array.from({ length: size }, (_, i) => i);

  while (true) {
    combinations.push(indices.map((index) => items[index]));

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

  return combinations;
}
