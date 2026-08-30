import { describe, expect, it, vi } from 'vitest';

const { supabaseFetchMock } = vi.hoisted(() => ({ supabaseFetchMock: vi.fn(async () => []) }));
vi.mock('../supabaseUtils', async () => {
  const actual = await vi.importActual<typeof import('../supabaseUtils')>('../supabaseUtils');
  return { ...actual, supabaseFetch: supabaseFetchMock };
});

import { fetchMatches, TOURNAMENT_MATCH_PAGE_LIMIT } from './persistence';

/**
 * The scheduler calls fetchMatches for every in-progress tournament on a
 * 30-second tick. It asked for `select=*` with no limit, so the response size
 * was bounded only by however many match rows a tournament happened to have.
 */
describe('fetchMatches', () => {
  it('bounds the response with an explicit limit', async () => {
    supabaseFetchMock.mockClear();

    await fetchMatches('tour-1');

    const path = supabaseFetchMock.mock.calls[0]![0] as string;
    expect(path).toContain(`limit=${TOURNAMENT_MATCH_PAGE_LIMIT}`);
  });

  it('still scopes to the tournament and keeps bracket order', async () => {
    supabaseFetchMock.mockClear();

    await fetchMatches('tour-1');

    const path = supabaseFetchMock.mock.calls[0]![0] as string;
    expect(path).toContain('tournament_id=eq.tour-1');
    expect(path).toContain('order=round.asc,match_number.asc');
  });

  it('has a limit comfortably above any real bracket', () => {
    // 8 players is a 7-match bracket; the cap is a backstop, not a page size
    // callers have to work around.
    expect(TOURNAMENT_MATCH_PAGE_LIMIT).toBeGreaterThanOrEqual(64);
  });
});
