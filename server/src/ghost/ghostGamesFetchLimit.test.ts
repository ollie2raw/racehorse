import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * ghost/service.ts captures SUPABASE_URL / SUPABASE_SERVICE_KEY into module
 * constants at import time, so setting them in beforeEach is too late — the
 * import has already run. Locally Vitest loads server/.env and they happen to
 * be present; CI has no secrets, so the module captured undefined and every
 * test threw "SUPABASE_URL is required".
 *
 * vi.hoisted runs before the imports below, which is the only place this can be
 * set from inside the test file.
 */
vi.hoisted(() => {
  process.env.SUPABASE_URL ||= 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_KEY ||= 'stub-service-key';
});

import { getGhostProfileSummary } from './service';

/**
 * ghost/service.ts carries its own module-local supabaseFetch that calls global
 * fetch directly, so the shared supabaseUtils mock does not reach it. Stub the
 * transport instead — this also keeps the test hermetic.
 */
const USER = '00000000-0000-4000-8000-000000000abc';

function moveLog(turn: number) {
  return [
    {
      turn,
      actor: 'you',
      tile_played: '6|6',
      branch: 'left',
      board_state: `board:${'x'.repeat(40)}:${turn}`,
      hand_before: ['6|6', '3|4'],
      score_delta: 5,
      hand_number: 1,
    },
  ];
}

function game(i: number, analyzable = true) {
  return {
    id: `game-${i}`,
    user_id: USER,
    played_at: `2026-08-${String(28 - (i % 27)).padStart(2, '0')}T00:00:00.000Z`,
    final_score: 60,
    opponent_score: 30,
    move_log: analyzable ? moveLog((i % 5) + 1) : [],
  };
}

let requestedPaths: string[] = [];

/** @param honourLimit false reproduces the old behaviour: always hand back all 30. */
function stubSupabase(games: ReturnType<typeof game>[], honourLimit = true) {
  requestedPaths = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL | string) => {
      const path = String(url);
      requestedPaths.push(path);
      let body: unknown = [];
      if (path.includes('/rest/v1/ghost_profiles')) {
        body = [
          {
            user_id: USER,
            ghost_rating: 900,
            last_updated: null,
            composite_log: null,
            style_profile: null,
            games_played: games.length,
          },
        ];
      } else if (path.includes('/rest/v1/ghost_games')) {
        const match = /limit=(\d+)/.exec(path);
        const limit = honourLimit && match ? Number(match[1]) : games.length;
        body = games.slice(0, limit);
      }
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }),
  );
}

const gamesQuery = () => requestedPaths.find((p) => p.includes('/rest/v1/ghost_games')) ?? '';

describe('ghost_games fetch limit', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests only the 20 games buildCompositeLog actually consumes', async () => {
    stubSupabase(Array.from({ length: 30 }, (_, i) => game(i)));
    await getGhostProfileSummary(USER);
    expect(gamesQuery()).toContain('limit=20');
    expect(gamesQuery()).not.toContain('limit=30');
  });

  it('makes exactly two Supabase reads per call', async () => {
    stubSupabase(Array.from({ length: 30 }, (_, i) => game(i)));
    await getGhostProfileSummary(USER);
    expect(requestedPaths).toHaveLength(2);
  });

  it('produces identical output to the 30-game fetch when every game is analyzable', async () => {
    const games = Array.from({ length: 30 }, (_, i) => game(i));
    const pin = (s: Awaited<ReturnType<typeof getGhostProfileSummary>>) =>
      JSON.stringify({
        ...s,
        compositeLog: s.compositeLog ? { ...s.compositeLog, generatedAt: 'pinned' } : null,
      });

    stubSupabase(games, true);
    const withTwenty = pin(await getGhostProfileSummary(USER));
    vi.unstubAllGlobals();

    stubSupabase(games, false); // old behaviour: 30 rows returned regardless
    const withThirty = pin(await getGhostProfileSummary(USER));

    expect(withTwenty).toBe(withThirty);
  });

  it('still fills 20 style snapshots from 20 analyzable games', async () => {
    stubSupabase(Array.from({ length: 30 }, (_, i) => game(i)));
    const summary = await getGhostProfileSummary(USER);
    expect(summary.compositeLog?.recentGameStyles).toHaveLength(20);
  });

  it('sources composite states from the 20 most recent games only', async () => {
    stubSupabase(Array.from({ length: 30 }, (_, i) => game(i)));
    const summary = await getGhostProfileSummary(USER);
    expect(summary.compositeLog?.sourceGameIds).toHaveLength(20);
    expect(summary.compositeLog?.sourceGameIds).not.toContain('game-20');
  });

  /**
   * The one case where 20 and 30 genuinely differ. `analyzeGameStyle` returns
   * null for a game with no analyzable player moves, and the old code filtered
   * before slicing — so it could reach into games 21-30 to top the list back up
   * to 20. Fetching 20 cannot.
   *
   * No production account hits this today: the only two with more than 20 games
   * have zero unanalyzable games in their most recent 30, and every other
   * account has fewer than 20 games in total. The aggregate this feeds is
   * "recent style", which a fixed recent window describes better than reaching
   * further back for filler.
   */
  it('yields fewer snapshots when some of the recent 20 are unanalyzable — the accepted tradeoff', async () => {
    stubSupabase(Array.from({ length: 30 }, (_, i) => game(i, i >= 3)));
    const summary = await getGhostProfileSummary(USER);
    expect(summary.compositeLog?.recentGameStyles).toHaveLength(17);
  });
});
