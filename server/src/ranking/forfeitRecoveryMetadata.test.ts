import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabaseFetch } from '../supabaseUtils';
import { processAllPendingRatingGames, processRealtimeMultiplayerGame, resetRatingCatchUpForTests, type Profile } from './periodService';
import { buildRankedGameInsertPayload } from './rankedGamePayload';

vi.mock('../supabaseUtils', () => ({ supabaseFetch: vi.fn() }));
const fetchMock = vi.mocked(supabaseFetch);
const profile = (id: string): Profile => ({ id, username: id, glicko_rating: 1500, glicko_rd: 200,
  glicko_vol: 0.06, glicko_last_period: null, ranked_games_played: 30, peak_rating: 1500, provisional: false });

afterEach(() => { vi.unstubAllEnvs(); fetchMock.mockReset(); resetRatingCatchUpForTests(); });

describe('documented R1: pending forfeit rows lack durable recovery metadata', () => {
  it('reproduces the disconnect multiplier gap without changing rating policy or schema', async () => {
    vi.stubEnv('RANKED_GAMES_OUTCOME_COLUMN_ENABLED', 'true');
    const persisted = buildRankedGameInsertPayload({ playerId: 'u1', opponentId: 'u2',
      playerScore: 40, opponentScore: 20, gameType: 'multiplayer', ratingBefore: 1500, rdBefore: 200,
      playedAt: '2026-10-01T00:00:00.000Z', outcome: 'loss' });
    const a = { ...persisted, id: 'g1', rating_after: null };
    const b = { ...a, id: 'g2', player_id: 'u2', opponent_id: 'u1', player_score: 20, opponent_score: 40, outcome: 'win' as const };
    const commits: Array<{ p_profile_id: string; p_delta: number }> = [];
    fetchMock.mockImplementation(async (path, init) => {
      if (path.startsWith('/rest/v1/profiles')) {
        const id = new URL(path, 'https://local.invalid').searchParams.get('id')!.slice(3);
        return [profile(id)] as never;
      }
      if (path.startsWith('/rest/v1/ranked_games')) return [a] as never;
      if (path.includes('/rpc/commit_glicko_game_update')) {
        commits.push(JSON.parse(String(init?.body)));
        return undefined as never;
      }
      throw new Error(`Unexpected local request: ${path}`);
    });
    await processRealtimeMultiplayerGame({ playerAProfile: profile('u1'), playerBProfile: profile('u2'),
      playerAGame: a, playerBGame: b, ratingScale: 0.5, playerAOutcome: 'loss', playerBOutcome: 'win' });
    const inlineDelta = commits.find((c) => c.p_profile_id === 'u1')!.p_delta;
    commits.length = 0;
    await processAllPendingRatingGames();
    const recoveredDelta = commits[0]!.p_delta;
    // Diagnostic evidence of the unresolved gap, not a desired contract. When
    // durable multiplier metadata ships, replace this with an equality guard.
    expect(inlineDelta).toBeLessThan(0);
    expect(recoveredDelta).toBeCloseTo(inlineDelta * 2, 8);
    expect(persisted).not.toHaveProperty('rating_scale');
  });
});
