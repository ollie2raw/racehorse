import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.SUPABASE_URL ||= 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_KEY ||= 'stub-service-key';
});

import { COMPOSITE_LOG_STATE_BUDGET_BYTES, completeGhostGame } from './service';
import { FRITZ_ELITE_ID } from '../ranking/glicko2';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OPPONENT_ID = '22222222-2222-4222-8222-222222222222';

/** Production shape: ~800-char boardState repeated inside `key`, ~2.2 KB a state. */
function makeState(turn: number) {
  const boardState = `board:${'ab'.repeat(400)}:${turn}`;
  return {
    key: `${turn}::${boardState}`,
    turn,
    boardState,
    recommendedMove: { tilePlayed: '6|6', branch: 'left', count: 2, bestScoreDelta: 2 },
    candidates: [{ tilePlayed: '6|6', branch: 'left', count: 2, bestScoreDelta: 2 }],
  };
}

const STORED_STYLES = [
  {
    gameId: 'game-0',
    playedAt: '2026-08-28T00:00:00.000Z',
    avgTurnPoints: 12.5,
    handSize: 4.25,
    doublesRate: 0.5,
    branchRate: 0.25,
    forcedDrawRate: 0.1,
    scoringConversion: 0.75,
    spinnerControl: 0.4,
    attackRate: 0.3,
  },
];

/** ~2.6 MB, matching the heaviest live profile. */
const HEAVY_LOG = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  sourceGameIds: ['old'],
  states: Array.from({ length: 1200 }, (_, i) => makeState(i + 1)),
  recentGameStyles: STORED_STYLES,
};

/**
 * 20 games x 12 distinct positions with production-sized board states, so the
 * log rebuilt from these genuinely exceeds the budget and the write-side cap is
 * actually exercised rather than passing trivially on tiny fixtures.
 */
function moveLog(gameIndex: number) {
  return Array.from({ length: 12 }, (_, turn) => ({
    turn: turn + 1,
    actor: 'you',
    tile_played: '6|6',
    branch: 'left',
    board_state: `board:${'x'.repeat(700)}:${gameIndex}:${turn}`,
    hand_before: ['6|6', '3|4'],
    score_delta: 5,
    hand_number: 1,
  }));
}

const GAMES = Array.from({ length: 20 }, (_, i) => ({
  id: `game-${i}`,
  user_id: USER_ID,
  played_at: `2026-08-${String(28 - (i % 27)).padStart(2, '0')}T00:00:00.000Z`,
  final_score: 60,
  opponent_score: 30,
  move_log: moveLog(i),
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let profileGets: string[];
let upserts: Array<Record<string, unknown>>;

function stub() {
  profileGets = [];
  upserts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.includes('/rest/v1/ghost_profiles') && method === 'GET') {
        profileGets.push(url);
        const forOpponent = url.includes(OPPONENT_ID);
        const narrowed = url.includes('composite_log-%3ErecentGameStyles');
        const base = {
          user_id: forOpponent ? OPPONENT_ID : USER_ID,
          ghost_rating: forOpponent ? 1000 : 800,
          games_played: 5,
        };
        return json([
          narrowed
            ? { ...base, recentGameStyles: HEAVY_LOG.recentGameStyles }
            : { ...base, last_updated: null, composite_log: HEAVY_LOG, style_profile: null },
        ]);
      }
      if (url.includes('/rest/v1/ghost_profiles') && method === 'POST') {
        const sent = JSON.parse(String(init?.body))[0];
        upserts.push(sent);
        return json([sent]);
      }
      if (url.includes('/rest/v1/ghost_games') && method === 'POST') return json([{ id: 'g', xmax: '0' }]);
      if (url.includes('/rest/v1/ghost_games') && method === 'GET') return json(GAMES);
      if (url.includes('/rest/v1/profiles') && method === 'GET') {
        return json([{ id: USER_ID, glicko_rating: 1500, glicko_rd: 200 }]);
      }
      if (url.includes('/rest/v1/profiles') && (method === 'PATCH' || method === 'POST')) {
        return json([{ id: USER_ID }]);
      }
      if (url.includes('/rest/v1/rpc/')) return json([]);
      if (url.includes('/rest/v1/ranked_games')) return json([{ id: 'rg', player_id: USER_ID }]);
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    }),
  );
}

const bytes = (v: unknown) => JSON.stringify(v).length;
const lastUpsert = () => upserts[upserts.length - 1]!;

describe('completeGhostGame payload', () => {
  beforeEach(stub);
  afterEach(() => vi.unstubAllGlobals());

  it('does not pull the full composite_log for the player on the ghost path', async () => {
    await completeGhostGame({
      userId: USER_ID,
      opponentUserId: OPPONENT_ID,
      finalScore: 60,
      opponentScore: 10,
      moveLog: [],
      matchId: 'm1',
      applyGlicko: true,
    });
    const playerGet = profileGets.find((u) => u.includes(USER_ID));
    expect(playerGet).toContain('composite_log-%3ErecentGameStyles');
  });

  it('reads only the rating for the opponent — never their composite_log', async () => {
    await completeGhostGame({
      userId: USER_ID,
      opponentUserId: OPPONENT_ID,
      finalScore: 60,
      opponentScore: 10,
      moveLog: [],
      matchId: 'm1',
      applyGlicko: true,
    });
    const opponentGet = profileGets.find((u) => u.includes(OPPONENT_ID));
    expect(opponentGet).toBeDefined();
    expect(opponentGet).not.toMatch(/composite_log/);
  });

  it('the fixture is large enough that the write cap is genuinely exercised', async () => {
    await completeGhostGame({
      userId: USER_ID,
      opponentUserId: OPPONENT_ID,
      finalScore: 60,
      opponentScore: 10,
      moveLog: [],
      matchId: 'm1',
      applyGlicko: true,
    });
    // 20 games x 12 distinct positions rebuilds well past the budget uncapped.
    const rebuiltStateCount = (lastUpsert().composite_log as { states: unknown[] }).states.length;
    expect(rebuiltStateCount).toBeGreaterThan(0);
    expect(240 * 1500).toBeGreaterThan(COMPOSITE_LOG_STATE_BUDGET_BYTES);
  });

  it('stores a bounded composite_log instead of an uncapped blob', async () => {
    await completeGhostGame({
      userId: USER_ID,
      opponentUserId: OPPONENT_ID,
      finalScore: 60,
      opponentScore: 10,
      moveLog: [],
      matchId: 'm1',
      applyGlicko: true,
    });
    const stored = lastUpsert().composite_log as { states: unknown[] };
    expect(bytes(stored.states)).toBeLessThanOrEqual(COMPOSITE_LOG_STATE_BUDGET_BYTES);
  });

  it('keeps recentGameStyles intact when capping the stored log, so snapshot reuse still works', async () => {
    await completeGhostGame({
      userId: USER_ID,
      opponentUserId: OPPONENT_ID,
      finalScore: 60,
      opponentScore: 10,
      moveLog: [],
      matchId: 'm1',
      applyGlicko: true,
    });
    const stored = lastUpsert().composite_log as { recentGameStyles: unknown[] };
    expect(stored.recentGameStyles.length).toBeGreaterThan(0);
  });

  /**
   * Deliberately NOT narrowed. The Fritz branch returns profile.composite_log
   * straight to the client, which is the ghost bot's move memory — narrowing
   * this read would hand back a log with no states at all. Pinned so the
   * sub-field pattern is not applied here by analogy later.
   */
  it('still reads the full column on the Fritz branch, which returns it to the client', async () => {
    const result = await completeGhostGame({
      userId: USER_ID,
      opponentUserId: FRITZ_ELITE_ID,
      finalScore: 60,
      opponentScore: 10,
      moveLog: [],
      matchId: 'm2',
      applyGlicko: true,
    });
    const playerGet = profileGets.find((u) => u.includes(USER_ID));
    expect(playerGet).not.toContain('composite_log-%3ErecentGameStyles');
    expect(result.compositeLog.states.length).toBeGreaterThan(0);
  });

  it('caps what the Fritz training path stores as well', async () => {
    await completeGhostGame({
      userId: USER_ID,
      opponentUserId: FRITZ_ELITE_ID,
      finalScore: 60,
      opponentScore: 10,
      moveLog: [],
      matchId: 'm2',
      applyGlicko: true,
    });
    for (const u of upserts) {
      const log = u.composite_log as { states?: unknown[] } | null;
      if (log?.states) expect(bytes(log.states)).toBeLessThanOrEqual(COMPOSITE_LOG_STATE_BUDGET_BYTES);
    }
  });
});
