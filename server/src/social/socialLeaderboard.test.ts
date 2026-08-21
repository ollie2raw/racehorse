import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(),
}));

vi.mock('./socialAuth', () => ({
  getFriendIds: vi.fn(),
}));

import { supabaseFetch } from '../supabaseUtils';
import { getFriendIds } from './socialAuth';
import {
  invalidateWeeklyLeaderboard,
  respondLeaderboardFriends,
  respondLeaderboardWeekly,
} from './socialLeaderboard';

const mockFetch = supabaseFetch as ReturnType<typeof vi.fn>;
const mockFriendIds = getFriendIds as ReturnType<typeof vi.fn>;

function makeRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) { res.statusCode = code; return res; },
    json(value: unknown) { res.body = value; return res; },
  };
  return res;
}

/** Every request the code issued, as PostgREST paths. */
function requestedPaths(): string[] {
  return mockFetch.mock.calls.map((c) => String(c[0]));
}

beforeEach(() => {
  mockFetch.mockReset();
  mockFriendIds.mockReset();
  invalidateWeeklyLeaderboard();
});

describe('respondLeaderboardFriends', () => {
  it('counts wins for every member in a single matches query', async () => {
    mockFriendIds.mockResolvedValueOnce(['friend-a', 'friend-b', 'friend-c']);
    // profiles
    mockFetch.mockResolvedValueOnce([
      { id: 'me', username: 'me', glicko_rating: 1000, ranked_games_played: 4, provisional: false },
      { id: 'friend-a', username: 'ada', glicko_rating: 950, ranked_games_played: 2, provisional: false },
      { id: 'friend-b', username: 'bo', glicko_rating: 900, ranked_games_played: 2, provisional: false },
      { id: 'friend-c', username: 'cy', glicko_rating: 850, ranked_games_played: 0, provisional: false },
    ]);
    // one matches query for all four users
    mockFetch.mockResolvedValueOnce([
      { winner_user_id: 'me' },
      { winner_user_id: 'me' },
      { winner_user_id: 'friend-a' },
      { winner_user_id: 'friend-b' },
      { winner_user_id: 'friend-b' },
      { winner_user_id: 'friend-b' },
    ]);

    const res = makeRes();
    await respondLeaderboardFriends('me', res as never);

    const matchQueries = requestedPaths().filter((p) => p.includes('/rest/v1/matches'));
    expect(matchQueries).toHaveLength(1);
    expect(matchQueries[0]).toContain('winner_user_id=in.');
    // Only the grouping column is selected.
    expect(matchQueries[0]).toContain('select=winner_user_id');

    const board = (res.body as { leaderboard: Array<{ userId: string; wins: number; win_rate: number }> }).leaderboard;
    expect(board.find((r) => r.userId === 'me')?.wins).toBe(2);
    expect(board.find((r) => r.userId === 'friend-a')?.wins).toBe(1);
    expect(board.find((r) => r.userId === 'friend-b')?.wins).toBe(3);
    // Nobody with zero wins is dropped or left undefined.
    expect(board.find((r) => r.userId === 'friend-c')?.wins).toBe(0);
    expect(board.find((r) => r.userId === 'friend-c')?.win_rate).toBe(0);
  });

  it('reports zero wins rather than failing when match history is unavailable', async () => {
    mockFriendIds.mockResolvedValueOnce(['friend-a']);
    mockFetch.mockResolvedValueOnce([
      { id: 'me', username: 'me', glicko_rating: 1000, ranked_games_played: 3, provisional: false },
      { id: 'friend-a', username: 'ada', glicko_rating: 950, ranked_games_played: 1, provisional: false },
    ]);
    mockFetch.mockRejectedValueOnce(new Error('matches unavailable'));

    const res = makeRes();
    await respondLeaderboardFriends('me', res as never);

    expect(res.statusCode).toBe(200);
    const board = (res.body as { leaderboard: Array<{ userId: string; wins: number }> }).leaderboard;
    expect(board.every((r) => r.wins === 0)).toBe(true);
  });
});

describe('respondLeaderboardWeekly', () => {
  function primeWeeklyResponses() {
    mockFetch.mockResolvedValueOnce([
      { winner_user_id: 'alice', loser_user_id: 'bob' },
      { winner_user_id: 'alice', loser_user_id: 'cara' },
      { winner_user_id: 'bob', loser_user_id: 'cara' },
    ]);
    mockFetch.mockResolvedValueOnce([
      { id: 'alice', username: 'alice', glicko_rating: 1200, provisional: false },
      { id: 'bob', username: 'bob', glicko_rating: 1100, provisional: false },
    ]);
  }

  it('ranks by wins this week and marks the caller', async () => {
    primeWeeklyResponses();
    const res = makeRes();
    await respondLeaderboardWeekly('bob', res as never);

    const body = res.body as {
      leaderboard: Array<{ userId: string; wins_this_week: number; rank: number; is_self: boolean }>;
      self: { userId: string } | null;
    };
    expect(body.leaderboard[0]).toMatchObject({ userId: 'alice', wins_this_week: 2, rank: 1, is_self: false });
    expect(body.leaderboard[1]).toMatchObject({ userId: 'bob', wins_this_week: 1, rank: 2, is_self: true });
    expect(body.self?.userId).toBe('bob');
  });

  it('serves a second caller from cache without re-reading matches', async () => {
    primeWeeklyResponses();
    const first = makeRes();
    await respondLeaderboardWeekly('alice', first as never);
    const callsAfterFirst = mockFetch.mock.calls.length;

    const second = makeRes();
    await respondLeaderboardWeekly('bob', second as never);

    // No further upstream reads for the second caller.
    expect(mockFetch.mock.calls.length).toBe(callsAfterFirst);

    // But is_self is still stamped per caller, not cached.
    const firstBody = first.body as { self: { userId: string } | null };
    const secondBody = second.body as { self: { userId: string } | null };
    expect(firstBody.self?.userId).toBe('alice');
    expect(secondBody.self?.userId).toBe('bob');
  });

  it('rebuilds after invalidation', async () => {
    primeWeeklyResponses();
    await respondLeaderboardWeekly('alice', makeRes() as never);
    const callsAfterFirst = mockFetch.mock.calls.length;

    invalidateWeeklyLeaderboard();
    primeWeeklyResponses();
    await respondLeaderboardWeekly('alice', makeRes() as never);

    expect(mockFetch.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});
