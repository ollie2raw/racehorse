import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(),
}));

import { supabaseFetch } from '../supabaseUtils';
import { getAutoRivals } from './rivalService';

const mockFetch = supabaseFetch as ReturnType<typeof vi.fn>;

beforeEach(() => { mockFetch.mockReset(); });

describe('getAutoRivals', () => {
  it('returns empty array when no matches', async () => {
    mockFetch.mockResolvedValueOnce([]); // matches
    const result = await getAutoRivals('u1');
    expect(result).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns top-3 opponents sorted by game count', async () => {
    // 3 games vs opp-a (2 wins 1 loss), 2 vs opp-b (1 win 1 loss), 1 vs opp-c (1 loss)
    mockFetch.mockResolvedValueOnce([
      { winner_user_id: 'u1',    loser_user_id: 'opp-a' },
      { winner_user_id: 'opp-a', loser_user_id: 'u1' },
      { winner_user_id: 'u1',    loser_user_id: 'opp-a' },
      { winner_user_id: 'u1',    loser_user_id: 'opp-b' },
      { winner_user_id: 'opp-b', loser_user_id: 'u1' },
      { winner_user_id: 'opp-c', loser_user_id: 'u1' },
    ]);
    mockFetch.mockResolvedValueOnce([
      { id: 'opp-a', username: 'alice', glicko_rating: 1300 },
      { id: 'opp-b', username: 'bob',   glicko_rating: 1100 },
      { id: 'opp-c', username: 'carol', glicko_rating: 900 },
    ]);
    const result = await getAutoRivals('u1');
    expect(result).toHaveLength(3);
    expect(result[0].userId).toBe('opp-a');
    expect(result[0].gamesPlayed).toBe(3);
    expect(result[0].winsAgainst).toBe(2);
    expect(result[0].lossesAgainst).toBe(1);
    expect(result[0].username).toBe('alice');
    expect(result[0].rating).toBe(1300);
    expect(result[1].userId).toBe('opp-b');
    expect(result[2].userId).toBe('opp-c');
  });

  it('caps result at 3 even with more opponents', async () => {
    const matches = ['a', 'b', 'c', 'd'].map((id) => ({
      winner_user_id: 'u1',
      loser_user_id: `opp-${id}`,
    }));
    mockFetch.mockResolvedValueOnce(matches);
    mockFetch.mockResolvedValueOnce(
      ['a', 'b', 'c', 'd'].map((id) => ({ id: `opp-${id}`, username: id, glicko_rating: 1000 })),
    );
    const result = await getAutoRivals('u1');
    expect(result).toHaveLength(3);
  });

  it('skips self-play rows where both sides are the same user', async () => {
    mockFetch.mockResolvedValueOnce([
      { winner_user_id: 'u1', loser_user_id: 'u1' },
    ]);
    const result = await getAutoRivals('u1');
    expect(result).toEqual([]);
  });

  it('handles profiles missing from profiles table gracefully', async () => {
    mockFetch.mockResolvedValueOnce([
      { winner_user_id: 'u1', loser_user_id: 'ghost-user' },
    ]);
    mockFetch.mockResolvedValueOnce([]); // profile not found
    const result = await getAutoRivals('u1');
    expect(result[0].username).toBe('player');
    expect(result[0].rating).toBeNull();
  });
});
