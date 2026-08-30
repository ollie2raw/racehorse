import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRankedGameInsertPayload } from './rankedGamePayload';
import { processRatingPeriod } from './periodService';
import { DEFAULT_RD, DEFAULT_VOL } from './glicko2';
import { supabaseFetch } from '../supabaseUtils';

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(),
}));

const mockedSupabaseFetch = vi.mocked(supabaseFetch);

const OUTCOME_FLAG = 'RANKED_GAMES_OUTCOME_COLUMN_ENABLED';

describe('ranked_games outcome column', () => {
  const original = process.env[OUTCOME_FLAG];

  afterEach(() => {
    if (original === undefined) delete process.env[OUTCOME_FLAG];
    else process.env[OUTCOME_FLAG] = original;
  });

  const base = {
    playerId: 'u1',
    opponentId: 'u2',
    playerScore: 40,
    opponentScore: 20,
    gameType: 'multiplayer',
    ratingBefore: 1500,
    rdBefore: 200,
    playedAt: '2026-08-28T00:00:00.000Z',
  };

  it('writes the outcome when the column is enabled', () => {
    process.env[OUTCOME_FLAG] = 'true';
    expect(buildRankedGameInsertPayload({ ...base, outcome: 'loss' })).toMatchObject({
      player_score: 40,
      opponent_score: 20,
      outcome: 'loss',
    });
  });

  it('omits the outcome when the column is not enabled, so the insert still succeeds', () => {
    delete process.env[OUTCOME_FLAG];
    expect(buildRankedGameInsertPayload({ ...base, outcome: 'loss' })).not.toHaveProperty('outcome');
  });

  it('omits the outcome for a match with no explicit result', () => {
    process.env[OUTCOME_FLAG] = 'true';
    expect(buildRankedGameInsertPayload(base)).not.toHaveProperty('outcome');
  });
});

describe('deferred rating period honours a persisted forfeit outcome', () => {
  const profile = {
    id: 'u1',
    username: 'quitter',
    glicko_rating: 1500,
    glicko_rd: DEFAULT_RD,
    glicko_vol: DEFAULT_VOL,
    glicko_last_period: null,
    ranked_games_played: 30,
    peak_rating: 1500,
    provisional: false,
  };

  function mockWith(outcome: 'win' | 'loss' | null) {
    mockedSupabaseFetch.mockImplementation(async (path: string) => {
      if (path.startsWith('/rest/v1/profiles?id=eq.u1')) return [profile] as never;
      if (path.startsWith('/rest/v1/profiles?id=eq.u2')) {
        return [{ ...profile, id: 'u2', username: 'stayer' }] as never;
      }
      if (path.startsWith('/rest/v1/ranked_games?player_id=eq.u1')) {
        return [
          {
            id: 'g1',
            player_id: 'u1',
            opponent_id: 'u2',
            // Quit while ahead 40-20.
            player_score: 40,
            opponent_score: 20,
            played_at: '2026-08-28T00:00:00.000Z',
            outcome,
          },
        ] as never;
      }
      return [] as never;
    });
  }

  beforeEach(() => {
    mockedSupabaseFetch.mockReset();
  });

  it('scores a persisted forfeit loss as a loss despite the winning scoreline', async () => {
    mockWith('loss');
    const result = await processRatingPeriod('u1');
    expect(result.delta).toBeLessThan(0);
    expect(result.newRating).toBeLessThan(1500);
  });

  it('still derives the result from scores when the row carries no outcome', async () => {
    mockWith(null);
    const result = await processRatingPeriod('u1');
    expect(result.delta).toBeGreaterThan(0);
  });
});
