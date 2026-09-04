import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { processRealtimeMultiplayerGame, type Profile } from './periodService';
import { DEFAULT_RD, DEFAULT_VOL, isProvisional } from './glicko2';
import { supabaseFetch } from '../supabaseUtils';

// RK-4 (HARDENING_PLAN §8.3): periodService previously wrote
// profiles.provisional from an independent `newGamesPlayed < 20` literal
// instead of calling the isProvisional() function that owns this value.
// This pins the boundary so a future edit to one copy without the other
// would fail here.

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(),
}));

const mockedSupabaseFetch = vi.mocked(supabaseFetch);

function profileWith(rankedGamesPlayed: number): Profile {
  return {
    id: 'u1',
    username: 'p1',
    glicko_rating: 1500,
    glicko_rd: DEFAULT_RD,
    glicko_vol: DEFAULT_VOL,
    glicko_last_period: null,
    ranked_games_played: rankedGamesPlayed,
    peak_rating: 1500,
    provisional: isProvisional(rankedGamesPlayed),
  };
}

function opponentProfile(): Profile {
  return profileWith(50);
}

const game = {
  id: 'g1',
  player_id: 'u1',
  opponent_id: 'u2',
  player_score: 60,
  opponent_score: 20,
  played_at: '2026-09-04T00:00:00.000Z',
};

describe('periodService — provisional flag derives from isProvisional(), not a duplicated literal', () => {
  let rpcBodies: Record<string, unknown>[];

  beforeEach(() => {
    rpcBodies = [];
    mockedSupabaseFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/rest/v1/rpc/commit_glicko_game_update') {
        rpcBodies.push(JSON.parse(String(init?.body)));
        return [] as never;
      }
      return [] as never;
    });
  });

  afterEach(() => {
    mockedSupabaseFetch.mockReset();
  });

  it('marks the profile provisional when the new games-played count is still under the threshold', async () => {
    // 18 games played + this one processed game = 19 → still provisional.
    await processRealtimeMultiplayerGame({
      playerAProfile: profileWith(18),
      playerBProfile: opponentProfile(),
      playerAGame: game,
      playerBGame: { ...game, id: 'g2', player_id: 'u2', opponent_id: 'u1', player_score: 20, opponent_score: 60 },
    });

    const playerABody = rpcBodies.find((b) => b.p_profile_id === 'u1')!;
    expect(playerABody.p_ranked_games_played).toBe(19);
    expect(playerABody.p_provisional).toBe(true);
    expect(playerABody.p_provisional).toBe(isProvisional(19));
  });

  it('clears the provisional flag exactly at the isProvisional() threshold', async () => {
    // 19 games played + this one processed game = 20 → no longer provisional.
    await processRealtimeMultiplayerGame({
      playerAProfile: profileWith(19),
      playerBProfile: opponentProfile(),
      playerAGame: game,
      playerBGame: { ...game, id: 'g2', player_id: 'u2', opponent_id: 'u1', player_score: 20, opponent_score: 60 },
    });

    const playerABody = rpcBodies.find((b) => b.p_profile_id === 'u1')!;
    expect(playerABody.p_ranked_games_played).toBe(20);
    expect(playerABody.p_provisional).toBe(false);
    expect(playerABody.p_provisional).toBe(isProvisional(20));
  });
});
