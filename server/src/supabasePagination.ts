/**
 * Paged reads for the maintenance scans.
 *
 * The weekly ranking jobs queried `profiles` and `ranked_games` with no limit,
 * so a single response had to carry every matching row and grew with the user
 * base. Paging bounds each request; `maxRows` bounds the whole scan, so a bad
 * predicate cannot walk an entire table into memory.
 */

/** Small enough that one page is a modest response, large enough to be few. */
export const DEFAULT_PAGE_SIZE = 500;

/** Ceiling for a single scan. Well above any real cohort; a backstop, not a policy. */
export const DEFAULT_MAX_ROWS = 100_000;

export type FetchPage<T> = (offset: number, limit: number) => Promise<T[]>;

export async function fetchAllPages<T>(
  fetchPage: FetchPage<T>,
  options: { pageSize?: number; maxRows?: number } = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;

  const rows: T[] = [];
  let offset = 0;

  while (rows.length < maxRows) {
    // Never ask for more than the remaining budget, so the ceiling is exact
    // rather than "the last page overshot it".
    const limit = Math.min(pageSize, maxRows - rows.length);
    const page = await fetchPage(offset, limit);
    rows.push(...page);
    if (page.length < limit) break;
    offset += page.length;
  }

  return rows.length > maxRows ? rows.slice(0, maxRows) : rows;
}
