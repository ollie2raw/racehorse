import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabaseUtils', () => ({ supabaseFetch: vi.fn() }));

import { supabaseFetch } from '../supabaseUtils';
import { recordMatchEnd } from './persistence';

const mockFetch = supabaseFetch as ReturnType<typeof vi.fn>;

beforeEach(() => mockFetch.mockReset().mockResolvedValue(undefined));

describe('recordMatchEnd — MP-G4 / MP-G5 (matchmaking half): first terminal write wins', () => {
  it('PATCHes conditional on status=eq.in_progress', async () => {
    await recordMatchEnd({
      matchId: 'mm-1',
      status: 'completed',
      winnerId: 'w1',
      playerARatingChange: 12,
      playerBRatingChange: -12,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [path, init] = mockFetch.mock.calls[0];
    expect(path).toBe('/rest/v1/matchmaking_matches?id=eq.mm-1&status=eq.in_progress');
    expect(init.method).toBe('PATCH');
  });

  it('a second call for the same match still targets in_progress only — the DB no-ops it', async () => {
    await recordMatchEnd({
      matchId: 'mm-1', status: 'completed', winnerId: 'w1',
      playerARatingChange: 12, playerBRatingChange: -12,
    });
    await recordMatchEnd({
      matchId: 'mm-1', status: 'forfeit', winnerId: 'l1',
      playerARatingChange: 6, playerBRatingChange: -6,
    });
    for (const [path] of mockFetch.mock.calls) {
      expect(path).toContain('status=eq.in_progress');
    }
  });

  it('sim matches are never written', async () => {
    await recordMatchEnd({
      matchId: 'sim-1', status: 'completed', winnerId: null,
      playerARatingChange: null, playerBRatingChange: null, isSim: true,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
