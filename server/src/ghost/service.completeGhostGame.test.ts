import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// service.ts reads SUPABASE_URL/SUPABASE_SERVICE_KEY into module-level
// constants at import time (not lazily per-call), so these must be set
// before the module graph below is evaluated — vi.hoisted runs first.
vi.hoisted(() => {
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';
});

import { completeGhostGame } from './service';
import { FRITZ_ELITE_ID } from '../ranking/glicko2';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OPPONENT_ID = '22222222-2222-4222-8222-222222222222';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('completeGhostGame — non-Fritz applyGlicko gating', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let profileUpsertBodies: Array<Record<string, unknown>>;

  beforeEach(() => {
    profileUpsertBodies = [];
    fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.includes('/rest/v1/ghost_profiles') && method === 'GET') {
        return jsonResponse([
          { user_id: USER_ID, ghost_rating: 800, last_updated: null, composite_log: null, style_profile: null, games_played: 5 },
        ]);
      }
      if (url.includes('/rest/v1/ghost_profiles') && method === 'POST') {
        const sent = JSON.parse(String(init?.body))[0];
        profileUpsertBodies.push(sent);
        return jsonResponse([sent]);
      }
      if (url.includes('/rest/v1/ghost_games') && method === 'POST') {
        return jsonResponse([{ id: 'game-1', xmax: '0' }]);
      }
      if (url.includes('/rest/v1/ghost_games') && method === 'GET') {
        return jsonResponse([]);
      }
      if (url.includes('/rest/v1/profiles') && method === 'GET') {
        return jsonResponse([{ id: USER_ID, glicko_rating: 1500, glicko_rd: 200 }]);
      }
      if (url.includes('/rest/v1/ranked_games') && method === 'POST') {
        return jsonResponse([{ id: 'rg-1', player_id: USER_ID }]);
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies a real rating change when applyGlicko is not false (default/true)', async () => {
    const result = await completeGhostGame({
      userId: USER_ID,
      opponentUserId: OPPONENT_ID,
      finalScore: 60,
      opponentScore: 10,
      moveLog: [],
      matchId: 'match-1',
      applyGlicko: true,
    });

    expect(result.ratingDelta).not.toBe(0);
    const finalUpsert = profileUpsertBodies[profileUpsertBodies.length - 1];
    expect(finalUpsert.ghost_rating).not.toBe(800);
  });

  it('writes NO rating change when applyGlicko is false — the score stays exactly what it was, not a fabricated delta', async () => {
    const result = await completeGhostGame({
      userId: USER_ID,
      opponentUserId: OPPONENT_ID,
      finalScore: 60,
      opponentScore: 10,
      moveLog: [],
      matchId: 'match-1',
      applyGlicko: false,
    });

    expect(result.ratingDelta).toBe(0);
    expect(result.newRating).toBe(800);
    const finalUpsert = profileUpsertBodies[profileUpsertBodies.length - 1];
    expect(finalUpsert.ghost_rating).toBe(800);
    expect(finalUpsert.games_played).toBe(5);
  });
});

describe('completeGhostGame — Fritz branch ghost_rating (training profile) side door', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let profileUpsertBodies: Array<Record<string, unknown>>;

  beforeEach(() => {
    profileUpsertBodies = [];
    fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.includes('/rest/v1/ghost_profiles') && method === 'GET') {
        return jsonResponse([
          { user_id: USER_ID, ghost_rating: 800, last_updated: null, composite_log: null, style_profile: null, games_played: 5 },
        ]);
      }
      if (url.includes('/rest/v1/ghost_profiles') && method === 'POST') {
        const sent = JSON.parse(String(init?.body))[0];
        profileUpsertBodies.push(sent);
        return jsonResponse([sent]);
      }
      if (url.includes('/rest/v1/ghost_games') && method === 'POST') {
        return jsonResponse([{ id: 'game-1', xmax: '0' }]);
      }
      if (url.includes('/rest/v1/ghost_games') && method === 'GET') {
        return jsonResponse([]);
      }
      if (url.includes('/rest/v1/profiles') && method === 'GET') {
        return jsonResponse([{ id: USER_ID, glicko_rating: 1500, glicko_rd: 200 }]);
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does NOT change ghost_rating (the training-profile side door) when applyGlicko is false — same fail-closed contract as the ranked Glicko write', async () => {
    // A Fritz completion with applyGlicko: false represents an unverified /
    // fail-closed result (e.g. no deal snapshot to replay against). The
    // profiles.glicko_rating write is correctly skipped in that case — but
    // persistFritzGhostTrainingProfile, called unconditionally, must not use
    // this rejected finalScore/opponentScore to move the user-visible
    // "Ghost Rating" (ghost_profiles.ghost_rating) either.
    await completeGhostGame({
      userId: USER_ID,
      opponentUserId: FRITZ_ELITE_ID,
      finalScore: 60,
      opponentScore: 10,
      moveLog: [],
      matchId: 'match-1',
      applyGlicko: false,
    });
    // persistFritzGhostTrainingProfile is fire-and-forget (void ...).catch(...)
    // inside completeGhostGame's Fritz branch — flush microtasks so its write
    // has landed before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const finalUpsert = profileUpsertBodies[profileUpsertBodies.length - 1];
    expect(finalUpsert.ghost_rating).toBe(800);
    expect(finalUpsert.games_played).toBe(5);
  });
});

describe('completeGhostGame — Fritz branch ranked_games idempotency (RK-2, HARDENING_PLAN §8.3)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let rankedGamesCalls: Array<{ path: string; body: Record<string, unknown> }>;

  function stub(rankedGamesResponse: unknown[]) {
    rankedGamesCalls = [];
    fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.includes('/rest/v1/ghost_profiles') && method === 'GET') {
        return jsonResponse([
          { user_id: USER_ID, ghost_rating: 800, last_updated: null, composite_log: null, style_profile: null, games_played: 5 },
        ]);
      }
      if (url.includes('/rest/v1/ghost_profiles') && method === 'POST') {
        return jsonResponse([JSON.parse(String(init?.body))[0]]);
      }
      if (url.includes('/rest/v1/ghost_games') && method === 'POST') {
        return jsonResponse([{ id: 'game-1', xmax: '0' }]);
      }
      if (url.includes('/rest/v1/ghost_games') && method === 'GET') {
        return jsonResponse([]);
      }
      if (url.includes('/rest/v1/profiles') && method === 'GET') {
        // Non-legacy shape (ranked_games_played/peak_rating already set) so
        // periodService's normalizeLegacyStartingProfile doesn't fire an
        // extra PATCH this stub doesn't otherwise handle.
        return jsonResponse([{ id: USER_ID, glicko_rating: 1500, glicko_rd: 200, ranked_games_played: 30, peak_rating: 1600, provisional: false }]);
      }
      if (url.includes('/rest/v1/ranked_games') && method === 'POST') {
        rankedGamesCalls.push({ path: url, body: JSON.parse(String(init?.body)) });
        return jsonResponse(rankedGamesResponse);
      }
      if (url.includes('/rest/v1/ranked_games') && method === 'GET') {
        // processRatingPeriod's getPendingGames sweep. Only a genuinely new
        // insert (rankedGamesResponse non-empty) has anything pending.
        return jsonResponse(
          rankedGamesResponse.length > 0
            ? rankedGamesResponse.map((row) => ({
                id: (row as { id: string }).id,
                player_id: USER_ID,
                opponent_id: FRITZ_ELITE_ID,
                player_score: 60,
                opponent_score: 10,
                played_at: new Date().toISOString(),
              }))
            : [],
        );
      }
      if (url.includes('/rest/v1/rpc/')) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('routes the Fritz ranked_games insert through insertRankedGameIdempotent (on_conflict + ignore-duplicates), not a bare POST', async () => {
    const OLD_ENV = process.env.RANKED_GAMES_SOURCE_COLUMNS_ENABLED;
    process.env.RANKED_GAMES_SOURCE_COLUMNS_ENABLED = 'true';
    try {
      stub([{ id: 'rg-1', player_id: USER_ID, source_match_id: 'match-1' }]);

      const result = await completeGhostGame({
        userId: USER_ID,
        opponentUserId: FRITZ_ELITE_ID,
        finalScore: 60,
        opponentScore: 10,
        moveLog: [],
        matchId: 'match-1',
        applyGlicko: true,
      });

      expect(rankedGamesCalls).toHaveLength(1);
      expect(rankedGamesCalls[0]!.path).toContain('on_conflict=player_id,source_match_id');
      expect(rankedGamesCalls[0]!.body).toMatchObject({ source_match_id: 'match-1' });
      // A genuinely new row → the rating actually applied.
      expect(result.glickoDelta).not.toBe(0);
    } finally {
      if (OLD_ENV === undefined) delete process.env.RANKED_GAMES_SOURCE_COLUMNS_ENABLED;
      else process.env.RANKED_GAMES_SOURCE_COLUMNS_ENABLED = OLD_ENV;
    }
  });

  it('a duplicate matchId (ignore-duplicates yields no row) is a no-op — no second rating application', async () => {
    const OLD_ENV = process.env.RANKED_GAMES_SOURCE_COLUMNS_ENABLED;
    process.env.RANKED_GAMES_SOURCE_COLUMNS_ENABLED = 'true';
    try {
      // PostgREST's ignore-duplicates response for a conflicting row: [].
      stub([]);

      const result = await completeGhostGame({
        userId: USER_ID,
        opponentUserId: FRITZ_ELITE_ID,
        finalScore: 60,
        opponentScore: 10,
        moveLog: [],
        matchId: 'match-1',
        applyGlicko: true,
      });

      expect(rankedGamesCalls).toHaveLength(1);
      // No second write anywhere, and the returned delta reflects "no change
      // applied" rather than a second computed rating.
      expect(result.glickoDelta).toBe(0);
      expect(result.glickoRating).toBe(1500);
    } finally {
      if (OLD_ENV === undefined) delete process.env.RANKED_GAMES_SOURCE_COLUMNS_ENABLED;
      else process.env.RANKED_GAMES_SOURCE_COLUMNS_ENABLED = OLD_ENV;
    }
  });
});
