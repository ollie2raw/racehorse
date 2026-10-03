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

describe('fetchDueLifecycleTournaments', () => {
  it('asks only for opened-upcoming and registration_open rows, four columns, bounded', async () => {
    const { fetchDueLifecycleTournaments } = await import('./persistence');
    supabaseFetchMock.mockClear();

    await fetchDueLifecycleTournaments(new Date('2026-10-03T02:00:00.000Z'));

    const path = decodeURIComponent(supabaseFetchMock.mock.calls[0]![0] as string);
    expect(path).toContain('select=id,status,registration_open_at,registration_close_at');
    expect(path).toContain('or=(and(status.eq.upcoming,registration_open_at.lte.2026-10-03T02:00:00.000Z),status.eq.registration_open)');
    expect(path).not.toContain('select=*');
    expect(path).toContain('limit=50');
  });
});

describe('/me batch readers', () => {
  it('fetchMatchesForTournaments reads all tournaments in one request and groups rows', async () => {
    const { fetchMatchesForTournaments } = await import('./persistence');
    supabaseFetchMock.mockClear();
    supabaseFetchMock.mockResolvedValueOnce([
      { id: 'm1', tournament_id: 't1' },
      { id: 'm2', tournament_id: 't2' },
      { id: 'm3', tournament_id: 't1' },
    ] as never);

    const grouped = await fetchMatchesForTournaments(['t1', 't2', 't3']);

    expect(supabaseFetchMock).toHaveBeenCalledTimes(1);
    const path = decodeURIComponent(supabaseFetchMock.mock.calls[0]![0] as string);
    expect(path).toContain('tournament_id=in.("t1","t2","t3")');
    expect(path).toContain('order=round.asc,match_number.asc');
    expect(grouped.get('t1')!.map((m) => m.id)).toEqual(['m1', 'm3']);
    expect(grouped.get('t2')!.map((m) => m.id)).toEqual(['m2']);
    expect(grouped.get('t3')).toEqual([]);
  });

  it('fetchTournamentsByIds is one request and skips the call for no ids', async () => {
    const { fetchTournamentsByIds } = await import('./persistence');
    supabaseFetchMock.mockClear();
    expect(await fetchTournamentsByIds([])).toEqual([]);
    expect(supabaseFetchMock).not.toHaveBeenCalled();
    await fetchTournamentsByIds(['t1', 't2']);
    expect(supabaseFetchMock).toHaveBeenCalledTimes(1);
    expect(decodeURIComponent(supabaseFetchMock.mock.calls[0]![0] as string)).toContain('id=in.("t1","t2")');
  });
});
