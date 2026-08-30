import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAGE_SIZE, fetchAllPages } from './supabasePagination';

/**
 * The weekly ranking maintenance scanned `profiles` and `ranked_games` with no
 * limit at all, so one request had to carry every matching row and its size
 * grew with the user base. These scans are now paged.
 */
describe('fetchAllPages', () => {
  it('returns a single short page without asking for another', async () => {
    const fetchPage = vi.fn(async () => [1, 2, 3]);

    expect(await fetchAllPages(fetchPage, { pageSize: 10 })).toEqual([1, 2, 3]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(0, 10);
  });

  it('keeps paging while pages come back full', async () => {
    const pages = [[1, 2], [3, 4], [5]];
    const fetchPage = vi.fn(async (offset: number) => pages[offset / 2] ?? []);

    expect(await fetchAllPages(fetchPage, { pageSize: 2 })).toEqual([1, 2, 3, 4, 5]);
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([0, 2, 4]);
  });

  it('asks once more when the last page is exactly full, then stops on the empty one', async () => {
    // Otherwise a total that is an exact multiple of the page size silently
    // drops nothing but leaves the caller unsure it finished.
    const pages: number[][] = [[1, 2], [3, 4], []];
    const fetchPage = vi.fn(async (offset: number) => pages[offset / 2] ?? []);

    expect(await fetchAllPages(fetchPage, { pageSize: 2 })).toEqual([1, 2, 3, 4]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('stops at maxRows rather than paging forever', async () => {
    // A runaway scan is the failure this exists to bound: without a ceiling a
    // bad predicate walks the whole table into memory.
    const fetchPage = vi.fn(async () => [1, 2]);

    const rows = await fetchAllPages(fetchPage, { pageSize: 2, maxRows: 5 });

    expect(rows).toHaveLength(5);
    expect(fetchPage.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('returns nothing for an empty first page', async () => {
    expect(await fetchAllPages(async () => [], { pageSize: 10 })).toEqual([]);
  });

  it('lets a failed page reject rather than returning a partial result as complete', async () => {
    const fetchPage = vi.fn(async (offset: number) => {
      if (offset > 0) throw new Error('supabase unavailable');
      return [1, 2];
    });

    await expect(fetchAllPages(fetchPage, { pageSize: 2 })).rejects.toThrow('supabase unavailable');
  });

  it('has a bounded default page size', () => {
    expect(DEFAULT_PAGE_SIZE).toBeGreaterThan(0);
    expect(DEFAULT_PAGE_SIZE).toBeLessThanOrEqual(1000);
  });
});
