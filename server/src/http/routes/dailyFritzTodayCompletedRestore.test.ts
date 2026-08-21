import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application } from 'express';
import type { DailyFritzAttemptRecord, DailyFritzRunRecord } from '../stores/dailyFritzStore';

// Fallback proof for the Daily Fritz terminal-hand hard-refresh claim: the
// real-browser Playwright scenario for this exact case
// (client/e2e/daily-fritz-server-restore.spec.ts, "D terminal") is blocked —
// see that spec's header comment for the specific, unresolved blocker. This
// test proves the same underlying claim — a hard refresh after the entire
// Daily Fritz set is verified-complete reconstructs the correct final result
// from server storage alone, not from anything the client remembers — at the
// route level instead.

const { authUserMock, getAttemptMock, getRunMock, getRunSummaryMock, leaderboardMock } = vi.hoisted(() => ({
  authUserMock: vi.fn(),
  getAttemptMock: vi.fn(),
  getRunMock: vi.fn(),
  getRunSummaryMock: vi.fn(),
  leaderboardMock: vi.fn(),
}));

vi.mock('../../platform/auth/supabaseAuth', () => ({
  getAuthenticatedUserId: authUserMock,
}));

vi.mock('../stores/dailyFritzStore', async () => {
  const actual = await vi.importActual<typeof import('../stores/dailyFritzStore')>(
    '../stores/dailyFritzStore',
  );
  return {
    ...actual,
    getDailyFritzAttempt: getAttemptMock,
    ensureDailyFritzRunForDate: getRunMock,
    // dailyFritzTodayRoute.ts also calls this separately from
    // ensureDailyFritzRunForDate for the response's run-summary fields — it
    // hits real Supabase if left unmocked, which is exactly what happened
    // in CI (no ambient SUPABASE_URL there, unlike a local dev shell with a
    // real .env — this test passed locally for the wrong reason the first
    // time around).
    getDailyFritzRunSummary: getRunSummaryMock,
    buildDailyFritzLeaderboard: leaderboardMock,
    getDailyFritzStreak: vi.fn().mockResolvedValue(0),
    listDailyFritzAttemptsForUser: vi.fn().mockResolvedValue([]),
  };
});

import { registerDailyFritzRoutes } from './dailyFritz';

type Handler = (req: any, res: any) => unknown | Promise<unknown>;

function makeHarness() {
  const routes = new Map<string, Handler>();
  const app = {
    get(path: string, handler: Handler) { routes.set(`GET ${path}`, handler); },
    post(path: string, handler: Handler) { routes.set(`POST ${path}`, handler); },
  };
  registerDailyFritzRoutes(app as unknown as Application);

  return async function request(method: 'GET' | 'POST', path: string, query: Record<string, string> = {}) {
    const handler = routes.get(`${method} ${path}`);
    if (!handler) throw new Error(`Missing route ${method} ${path}`);
    let status = 200;
    let body: unknown;
    const res = {
      status(code: number) { status = code; return res; },
      json(value: unknown) { body = value; return res; },
      setHeader() { return res; },
      set() { return res; },
      once() { return res; },
    };
    await handler({ headers: {}, params: {}, query, body: {}, method, path, get() { return undefined; } }, res);
    return { status, body: body as any };
  };
}

const RUN_DATE = '2026-08-10';
const USER_ID = 'user-1';

describe('GET /api/daily-fritz/today — hard refresh after the full set is verified-complete', () => {
  const previousFixturesFlag = process.env.DAILY_FRITZ_TEST_FIXTURES_ENABLED;

  beforeEach(() => {
    process.env.DAILY_FRITZ_TEST_FIXTURES_ENABLED = 'true';
    authUserMock.mockResolvedValue(USER_ID);
    leaderboardMock.mockResolvedValue([]);
  });

  afterEach(() => {
    authUserMock.mockReset();
    getAttemptMock.mockReset();
    getRunMock.mockReset();
    getRunSummaryMock.mockReset();
    leaderboardMock.mockReset();
    if (previousFixturesFlag === undefined) delete process.env.DAILY_FRITZ_TEST_FIXTURES_ENABLED;
    else process.env.DAILY_FRITZ_TEST_FIXTURES_ENABLED = previousFixturesFlag;
  });

  it('reconstructs the exact verified final result from server storage alone — not a client cache, not a default', async () => {
    const run: DailyFritzRunRecord = {
      runDate: RUN_DATE,
      seed: 'seed-x',
      fritzTier: 'standard',
      dealSize: 7,
      winningScore: 1,
      status: 'live',
      handDeals: [],
      generatedAt: '2026-08-10T00:00:00.000Z',
      invalidatedAt: null,
      metadata: {},
    };
    // The verified, persisted outcome of a completed 2-of-3 Daily Fritz set —
    // exactly the shape a real completed attempt's `result` holds. A
    // reconstruction bug that silently defaults to {you:0, fritz:0} or drops
    // the game entirely must be caught, not accidentally matched.
    const verifiedResult = {
      games: [
        { gameNumber: 1, finalScore: 1, opponentScore: 0, winner: 'you' },
        { gameNumber: 2, finalScore: 1, opponentScore: 0, winner: 'you' },
      ],
      setWinner: 'you',
    };
    const completedAttempt: DailyFritzAttemptRecord = {
      id: 'attempt-1',
      runDate: RUN_DATE,
      userId: USER_ID,
      status: 'completed',
      currentHandIndex: 2,
      currentGameNumber: 2,
      revision: 3,
      challengeId: null,
      challengeContractVersion: null,
      generationVersion: null,
      gameRulesVersion: null,
      transcriptProtocolVersion: null,
      fritzPolicyVersion: null,
      rankingVersion: null,
      authoritySchemaVersion: 1,
      startedAt: '2026-08-10T00:00:00.000Z',
      completedAt: '2026-08-10T00:05:00.000Z',
      verifiedMatchId: 'verified-match-1',
      completionHash: 'hash-1',
      result: verifiedResult,
      finalScore: 1,
      opponentScore: 0,
      pointDiff: 1,
      won: true,
      movesUsed: 2,
      handsPlayed: 2,
    };
    getAttemptMock.mockResolvedValue(completedAttempt);
    getRunMock.mockResolvedValue(run);
    getRunSummaryMock.mockResolvedValue({
      runDate: run.runDate,
      fritzTier: run.fritzTier,
      dealSize: run.dealSize,
      winningScore: run.winningScore,
      status: run.status,
    });

    // A brand-new request with zero client-held memory — the only thing a
    // hard-refreshed page can send: a plain GET with the debug date pinned
    // to this fixture's run date.
    const request = makeHarness();
    const response = await request('GET', '/api/daily-fritz/today', { debugDate: RUN_DATE });

    expect(response.status).toBe(200);
    expect(response.body.attempt_status).toBe('completed');
    expect(response.body.result).toEqual(verifiedResult);
    expect(response.body.result.games[0].finalScore > 0 || response.body.result.games[0].opponentScore > 0).toBe(true);
  });
});
