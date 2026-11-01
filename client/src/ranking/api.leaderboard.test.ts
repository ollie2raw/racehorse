// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('../api/client', () => ({ apiGet }));
vi.mock('../lib/supabase', () => ({ supabase: null }));

const { fetchRankingLeaderboard } = await import('./api');

const entry = { userId: 'u1', username: 'maya', glicko_rating: 1500, ranked_games_played: 12 };

beforeEach(() => apiGet.mockReset());

describe('fetchRankingLeaderboard', () => {
  it('asks the public board for the requested number of rows, without an auth header', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, leaderboard: [entry] }, error: null });
    await fetchRankingLeaderboard(25);
    expect(apiGet).toHaveBeenCalledWith('/api/ranking/leaderboard?limit=25', { auth: false });
  });

  it('returns the rows', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, leaderboard: [entry] }, error: null });
    expect(await fetchRankingLeaderboard()).toEqual({ data: { leaderboard: [entry] }, error: null });
    expect(apiGet).toHaveBeenCalledWith('/api/ranking/leaderboard?limit=50', { auth: false });
  });

  it('passes the server\'s "board could not be built" flag through with an empty list, as no error', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, leaderboard: [entry], leaderboard_load_failed: true }, error: null });
    expect(await fetchRankingLeaderboard()).toEqual({
      data: { leaderboard: [], leaderboard_load_failed: true },
      error: null,
    });
  });

  it('treats a malformed body as an empty board rather than crashing', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, leaderboard: 'nope' }, error: null });
    expect(await fetchRankingLeaderboard()).toEqual({ data: { leaderboard: [] }, error: null });
  });

  it.each([
    ['a server error', { data: null, error: 'Request failed (500)', status: 500 }],
    ['a timeout', { data: null, error: 'Request timed out. Please try again.' }],
    ['a network failure', { data: null, error: 'Failed to fetch' }],
    ['an empty success', { data: null, error: null, status: 204 }],
  ])('gives one plain message for %s, never the transport detail', async (_label, result) => {
    apiGet.mockResolvedValue(result);
    expect(await fetchRankingLeaderboard()).toEqual({ data: null, error: 'Failed to load leaderboard.' });
  });
});
