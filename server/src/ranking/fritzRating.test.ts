import { describe, expect, it, vi } from 'vitest';
import {
  computeGlicko2,
  DEFAULT_RD,
  DEFAULT_RATING,
  DEFAULT_VOL,
  FRITZ_MASTER_ID,
  getFritzConfig,
} from './glicko2';
import { processRatingPeriod } from './periodService';
import { supabaseFetch } from '../supabaseUtils';

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(),
}));

const mockedSupabaseFetch = vi.mocked(supabaseFetch);

describe('Fritz rating processing', () => {
  it('keeps the server Master rating aligned with the visible 2200 tier', () => {
    expect(getFritzConfig(FRITZ_MASTER_ID)).toMatchObject({
      rating: 2200,
      rd: 50,
      difficulty: 'master',
    });
  });

  it('returns a positive non-zero Glicko delta for a win over Fritz Master', async () => {
    mockedSupabaseFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/rest/v1/profiles?id=eq.player-1')) {
        return [
          {
            id: 'player-1',
            username: 'tester',
            glicko_rating: DEFAULT_RATING,
            glicko_rd: DEFAULT_RD,
            glicko_vol: DEFAULT_VOL,
            glicko_last_period: null,
            ranked_games_played: 0,
            peak_rating: DEFAULT_RATING,
            provisional: true,
          },
        ];
      }

      if (path === '/rest/v1/ranked_games?player_id=eq.player-1&rating_after=is.null&order=played_at.asc,id.asc') {
        return [
          {
            id: 'game-1',
            player_id: 'player-1',
            opponent_id: FRITZ_MASTER_ID,
            player_score: 61,
            opponent_score: 42,
            played_at: '2026-04-09T12:00:00.000Z',
            rating_after: null,
            delta: null,
          },
        ];
      }

      if (init?.method === 'PATCH' || init?.method === 'POST') {
        return [];
      }

      throw new Error(`Unexpected Supabase call in Fritz rating test: ${path}`);
    });

    const result = await processRatingPeriod('player-1');

    expect(result.gamesInPeriod).toBe(1);
    expect(result.delta).toBeGreaterThan(0);
    expect(Math.round(result.delta)).toBeGreaterThan(0);
    expect(result.newRating).toBeGreaterThan(DEFAULT_RATING);

    const rpcCall = mockedSupabaseFetch.mock.calls.find(
      ([path, init]) => path === '/rest/v1/rpc/commit_glicko_game_update' && init?.method === 'POST',
    );
    expect(rpcCall).toBeTruthy();
    const body = JSON.parse(String(rpcCall?.[1]?.body));
    expect(body.p_game_id).toBe('game-1');
    expect(body.p_delta).toBeGreaterThan(0);
  });

  it('applies almost no penalty for an expected loss to a far stronger Fritz Master', () => {
    const master = getFritzConfig(FRITZ_MASTER_ID);
    const result = computeGlicko2(
      {
        rating: DEFAULT_RATING,
        rd: DEFAULT_RD,
        vol: DEFAULT_VOL,
        gamesPlayed: 0,
      },
      [
        {
          opponent: { rating: master.rating, rd: master.rd },
          result: { score: 8, opponentScore: 61 },
        },
      ],
    );
    const delta = result.newRating - DEFAULT_RATING;

    expect(delta).toBeLessThan(0);
    expect(delta).toBeGreaterThan(-1);
    expect(Object.is(Math.round(delta), -0)).toBe(true);
  });
});
