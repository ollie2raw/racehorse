import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.SUPABASE_URL ||= 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_KEY ||= 'stub-service-key';
});

import { FRITZ_ELITE_ID } from '../ranking/glicko2';
import {
  buildCompositeLog,
  completeGhostGame,
  compositeLogForStorage,
  getGhostProfileSummary,
  GHOST_COMPOSITE_BUILDER_VERSION,
} from './service';

/**
 * E2: the summary serves the stored, capped composite_log instead of reading
 * 20 move logs, but only when that log was built by the current builder from
 * exactly the player's latest games. These tests prove the response is the
 * same as a rebuild (shape and values), that no move log is read on that
 * path, and that every other case falls back to the rebuild.
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

function game(i: number) {
  return {
    id: `game-${i}`,
    user_id: USER,
    played_at: `2026-09-${String(28 - i).padStart(2, '0')}T00:00:00.000Z`,
    final_score: 40 + i,
    opponent_score: 30,
    move_log: moveLog((i % 5) + 1),
  };
}

const GAMES = Array.from({ length: 20 }, (_, i) => game(i));

type Stored = Record<string, unknown> | null;

let requestedPaths: string[] = [];

/** Emulates PostgREST for the three ghost_profiles projections and both ghost_games selects. */
function stubSupabase(stored: Stored, games = GAMES) {
  requestedPaths = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL | string) => {
      const path = decodeURIComponent(String(url));
      requestedPaths.push(path);
      let body: unknown = [];
      if (path.includes('/rest/v1/ghost_profiles') && path.includes('select=composite_log&')) {
        body = [{ composite_log: stored }];
      } else if (path.includes('/rest/v1/ghost_profiles')) {
        body = [
          {
            user_id: USER,
            ghost_rating: 900,
            games_played: games.length,
            recentGameStyles: (stored?.recentGameStyles as unknown) ?? null,
            compositeBuilderVersion: (stored?.builderVersion as unknown) ?? null,
            compositeSourceGameIds: (stored?.sourceGameIds as unknown) ?? null,
          },
        ];
      } else if (path.includes('/rest/v1/ghost_games')) {
        body = path.includes('move_log')
          ? games
          : games.map(({ id, played_at, final_score }) => ({ id, played_at, final_score }));
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

/** What completeGhostGame stores after the last of these games. */
function storedLogFor(games: typeof GAMES) {
  return compositeLogForStorage(buildCompositeLog(games as never, games as never, null)) as unknown as Record<string, unknown>;
}

const pin = (s: Awaited<ReturnType<typeof getGhostProfileSummary>>) =>
  JSON.stringify({ ...s, compositeLog: s.compositeLog ? { ...s.compositeLog, generatedAt: 'pinned' } : null });

const movelogReads = () => requestedPaths.filter((p) => p.includes('/rest/v1/ghost_games') && p.includes('move_log'));

describe('ghost summary from the stored composite log (E2)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serves the stored log without reading any move log', async () => {
    stubSupabase(storedLogFor(GAMES));
    await getGhostProfileSummary(USER);
    expect(movelogReads()).toEqual([]);
    expect(requestedPaths).toHaveLength(3);
  });

  it('returns exactly what the rebuild returns: same keys, same values (generatedAt aside)', async () => {
    const stored = storedLogFor(GAMES);
    stubSupabase(stored);
    const fromStored = await getGhostProfileSummary(USER);

    // The same data without the version stamp forces the rebuild path.
    const { builderVersion: _v, ...unversioned } = stored;
    stubSupabase(unversioned);
    const rebuilt = await getGhostProfileSummary(USER);
    expect(movelogReads()).toHaveLength(1);

    expect(Object.keys(fromStored).sort()).toEqual(Object.keys(rebuilt).sort());
    expect(Object.keys(fromStored).sort()).toEqual(
      ['avgScore', 'compositeLog', 'gamesPlayed', 'ghostRating', 'paddingGames', 'recentScores', 'styleProfile'],
    );
    expect(Object.keys(fromStored.compositeLog ?? {}).sort()).toEqual(
      ['generatedAt', 'recentGameStyles', 'sourceGameIds', 'states'],
    );
    expect(pin(fromStored)).toBe(pin(rebuilt));
  });

  it('never sends the storage stamp to the client', async () => {
    stubSupabase(storedLogFor(GAMES));
    const summary = await getGhostProfileSummary(USER);
    expect(summary.compositeLog).not.toHaveProperty('builderVersion');
  });

  it('rebuilds when the stored log was written by another builder version', async () => {
    stubSupabase({ ...storedLogFor(GAMES), builderVersion: GHOST_COMPOSITE_BUILDER_VERSION + 1 });
    await getGhostProfileSummary(USER);
    expect(movelogReads()).toHaveLength(1);
  });

  it('rebuilds when the player has games the stored log did not see', async () => {
    const stored = storedLogFor(GAMES.slice(1));
    stubSupabase(stored);
    await getGhostProfileSummary(USER);
    expect(movelogReads()).toHaveLength(1);
  });

  it('rebuilds when there is no stored log, and handles a player with no games', async () => {
    stubSupabase(null);
    const summary = await getGhostProfileSummary(USER);
    expect(movelogReads()).toHaveLength(1);
    expect(summary.compositeLog?.states.length).toBeGreaterThan(0);

    stubSupabase(null, []);
    const empty = await getGhostProfileSummary(USER);
    expect(empty.compositeLog).toBeNull();
    expect(empty.recentScores).toEqual([]);
  });
});

describe('stored composite log stamp (E2)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('completion stores a version-stamped log but returns none to the client (Fritz path)', async () => {
    const upserts: Array<Record<string, unknown>> = [];
    const storedWithStamp = storedLogFor(GAMES);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        const json = (body: unknown) =>
          new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
        if (url.includes('/rest/v1/ghost_profiles') && method === 'GET') {
          return json([{ user_id: USER, ghost_rating: 800, last_updated: null, composite_log: storedWithStamp, style_profile: null, games_played: 5 }]);
        }
        if (url.includes('/rest/v1/ghost_profiles') && method === 'POST') {
          const sent = JSON.parse(String(init?.body))[0];
          upserts.push(sent);
          return json([sent]);
        }
        if (url.includes('/rest/v1/ghost_games') && method === 'POST') return json([{ id: 'game-new', xmax: '0' }]);
        if (url.includes('/rest/v1/ghost_games') && method === 'GET') return json(GAMES);
        if (url.includes('/rest/v1/profiles') && method === 'GET') return json([{ id: USER, glicko_rating: 1500, glicko_rd: 200 }]);
        if (url.includes('/rest/v1/ranked_games') && method === 'POST') return json([{ id: 'rg-1', player_id: USER }]);
        return json([]);
      }),
    );

    const result = await completeGhostGame({
      userId: USER,
      opponentUserId: FRITZ_ELITE_ID,
      finalScore: 60,
      opponentScore: 10,
      moveLog: [],
      playerMoveLog: [],
      matchId: 'match-1',
      applyGlicko: false,
    });

    expect(result.compositeLog).not.toHaveProperty('builderVersion');
    // The Fritz training write is deferred (fire-and-forget) by design.
    await vi.waitFor(() => expect(upserts.some((u) => u.composite_log)).toBe(true));
    const written = upserts.find((u) => u.composite_log);
    expect((written!.composite_log as Record<string, unknown>).builderVersion).toBe(GHOST_COMPOSITE_BUILDER_VERSION);
  });

  it('the ghost completion path writes the stamp', async () => {
    const upserts: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        const json = (body: unknown) =>
          new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
        if (url.includes('/rest/v1/ghost_profiles') && method === 'GET') {
          return json([{ user_id: USER, ghost_rating: 800, last_updated: null, composite_log: null, style_profile: null, games_played: 5 }]);
        }
        if (url.includes('/rest/v1/ghost_profiles') && method === 'POST') {
          const sent = JSON.parse(String(init?.body))[0];
          upserts.push(sent);
          return json([sent]);
        }
        if (url.includes('/rest/v1/ghost_games') && method === 'POST') return json([{ id: 'game-new', xmax: '0' }]);
        if (url.includes('/rest/v1/ghost_games') && method === 'GET') return json(GAMES);
        return json([]);
      }),
    );

    const result = await completeGhostGame({
      userId: USER,
      opponentUserId: '22222222-2222-4222-8222-222222222222',
      finalScore: 60,
      opponentScore: 10,
      moveLog: [],
      matchId: 'match-2',
      applyGlicko: true,
    });

    expect(result.compositeLog).not.toHaveProperty('builderVersion');
    const written = upserts.at(-1)!;
    expect((written.composite_log as Record<string, unknown>).builderVersion).toBe(GHOST_COMPOSITE_BUILDER_VERSION);
    expect((written.composite_log as Record<string, unknown>).sourceGameIds).toEqual(GAMES.map((g) => g.id));
  });
});
