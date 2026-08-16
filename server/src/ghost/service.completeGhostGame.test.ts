import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
