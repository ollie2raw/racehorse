/**
 * Regression cover for the historically trapped attempts.
 *
 * Two protocol-v2 attempts were still sitting at status='started' with a
 * populated unverified_hands ledger when PR #58 shipped (read-only production
 * query, 2026-08-24):
 *
 *   user a7442fca, run 2026-08-20 — game 2 hand 8, verification_status
 *     'rejected', 5 unverified hands (illegal_action, missing_hand_start_progress)
 *   user 291bdfc3, run 2026-08-21 — game 2 hand 2, verification_status
 *     'in_progress', 4 unverified hands (fritz_state_mismatch, then
 *     missing_hand_start_progress ×3)
 *
 * Both shapes are reproduced here. The claim under test is that resume no
 * longer consults verification state at all: /today must hand back a playable
 * position rather than the "Couldn't verify this hand yet" dead end. No row is
 * mutated to achieve this — the fix is purely the removal of the gates.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Application } from 'express';
import { getDailyFritzSeed } from '../../dailyFritz';
import type { DailyFritzAttemptRecord, DailyFritzRunRecord } from '../stores/dailyFritzStore';
import { isDailyFritzAttemptLeaderboardEligible } from '../stores/dailyFritzStore';
import { formatDailyFritzRunDatePacific } from '../stores/dailyFritzHealthSummary';

const mockFetch = vi.fn(async () => ({
  ok: true,
  status: 200,
  text: async () => '[]',
  json: async () => [],
} as unknown as Response));
vi.stubGlobal('fetch', mockFetch);

vi.mock('../../config', () => ({
  config: {
    supabaseUrl: 'https://test.supabase.co',
    supabasePoolerUrl: null,
    supabaseServiceKey: 'test-key',
  },
}));

const { authUserMock, getAttemptByIdMock, getAttemptMock, upsertAttemptMock, getRunMock } = vi.hoisted(() => ({
  authUserMock: vi.fn(),
  getAttemptByIdMock: vi.fn(),
  getAttemptMock: vi.fn(),
  upsertAttemptMock: vi.fn(),
  getRunMock: vi.fn(),
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
    getDailyFritzAttemptById: getAttemptByIdMock,
    getDailyFritzAttempt: getAttemptMock,
    upsertDailyFritzAttempt: upsertAttemptMock,
    getDailyFritzRun: getRunMock,
    ensureDailyFritzRunForDate: getRunMock,
  };
});

vi.mock('../stores/dailyFritzEventStore', async () => {
  const actual = await vi.importActual<typeof import('../stores/dailyFritzEventStore')>(
    '../stores/dailyFritzEventStore',
  );
  return {
    ...actual,
    recordDailyFritzEvent: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../social/activityWriter', () => ({
  writeDailyFritzGameActivity: vi.fn().mockResolvedValue(undefined),
}));

import { registerDailyFritzRoutes } from './dailyFritz';

type Handler = (req: any, res: any) => unknown | Promise<unknown>;

function makeHarness() {
  const routes = new Map<string, Handler>();
  const app = {
    get(path: string, handler: Handler) { routes.set(`GET ${path}`, handler); },
    post(path: string, handler: Handler) { routes.set(`POST ${path}`, handler); },
  };
  registerDailyFritzRoutes(app as unknown as Application);

  return async function request(method: 'GET' | 'POST', path: string) {
    const handler = routes.get(`${method} ${path}`);
    if (!handler) throw new Error(`Missing route ${method} ${path}`);
    let status = 200;
    let body: unknown;
    const res = {
      status(code: number) { status = code; return res; },
      json(value: unknown) { body = value; return res; },
      setHeader() { return res; },
      set() { return res; },
      vary() { return res; },
      once() { return res; },
    };
    await handler({
      headers: {}, params: {}, query: {}, body: {}, method, path,
      get() { return undefined; },
    }, res);
    return { status, body: body as any };
  };
}

const DEAL = {
  player_tiles: [{ low: 4, high: 4 }, { low: 1, high: 2 }],
  fritz_tiles: [{ low: 6, high: 6 }],
  boneyard: [{ low: 1, high: 3 }, { low: 2, high: 6 }],
  locked: [],
};

function buildRun(runDate: string): DailyFritzRunRecord {
  return {
    runDate,
    seed: getDailyFritzSeed(runDate),
    fritzTier: 'standard',
    dealSize: 7,
    winningScore: 60,
    status: 'live',
    handDeals: Array.from({ length: 12 }, () => DEAL),
    generatedAt: `${runDate}T00:00:00.000Z`,
    invalidatedAt: null,
    metadata: { draw_winners_by_game: { '1': 'you', '2': 'you', '3': 'you' } },
  } as DailyFritzRunRecord;
}

/**
 * The exact production result shapes, minus PII.
 *
 * `runDate` is the CURRENT Pacific run date rather than the historical one:
 * /today resolves the live run date by definition, so pinning a past date
 * would test date routing instead of the thing under test. What is preserved
 * verbatim is the attempt state that did the trapping — the cursor position
 * and the unverified_hands ledger.
 */
const RUN_DATE = formatDailyFritzRunDatePacific();

const TRAPPED = [
  {
    label: 'a7442fca / 2026-08-20 — rejected, 5 unverified hands',
    runDate: RUN_DATE,
    userId: 'a7442fca-0000-4000-8000-000000000001',
    attemptId: 'a7442fca-0000-4000-8000-0000000000a1',
    currentGameNumber: 2 as const,
    currentHandIndex: 8,
    result: {
      verification_status: 'rejected',
      verification_protocol_version: 2,
      authority: { version: 1, hands: [], games: [] },
      unverified_hands: [
        { game_number: 1, hand_index: 4, verifier_code: 'illegal_action' },
        { game_number: 1, hand_index: 5, verifier_code: 'missing_hand_start_progress' },
        { game_number: 1, hand_index: 6, verifier_code: 'missing_hand_start_progress' },
        { game_number: 2, hand_index: 6, verifier_code: 'illegal_action' },
        { game_number: 2, hand_index: 7, verifier_code: 'missing_hand_start_progress' },
      ],
    },
  },
  {
    label: '291bdfc3 / 2026-08-21 — in_progress despite 4 unverified hands',
    runDate: RUN_DATE,
    userId: '291bdfc3-0000-4000-8000-000000000002',
    attemptId: '291bdfc3-0000-4000-8000-0000000000a2',
    currentGameNumber: 2 as const,
    currentHandIndex: 2,
    result: {
      verification_status: 'in_progress',
      verification_protocol_version: 2,
      authority: { version: 1, hands: [], games: [] },
      unverified_hands: [
        { game_number: 1, hand_index: 1, verifier_code: 'fritz_state_mismatch' },
        { game_number: 1, hand_index: 2, verifier_code: 'missing_hand_start_progress' },
        { game_number: 1, hand_index: 3, verifier_code: 'missing_hand_start_progress' },
        { game_number: 1, hand_index: 4, verifier_code: 'missing_hand_start_progress' },
      ],
    },
  },
];

function buildAttempt(fixture: typeof TRAPPED[number]): DailyFritzAttemptRecord {
  return {
    id: fixture.attemptId,
    runDate: fixture.runDate,
    userId: fixture.userId,
    status: 'started',
    currentHandIndex: fixture.currentHandIndex,
    currentGameNumber: fixture.currentGameNumber,
    revision: 9,
    challengeId: null,
    challengeContractVersion: null,
    generationVersion: null,
    gameRulesVersion: null,
    transcriptProtocolVersion: 2,
    fritzPolicyVersion: null,
    rankingVersion: null,
    authoritySchemaVersion: 1,
    startedAt: `${fixture.runDate}T13:00:00.000Z`,
    completedAt: null,
    verifiedMatchId: `match-${fixture.attemptId}`,
    completionHash: null,
    result: fixture.result,
    finalScore: null,
    opponentScore: null,
    pointDiff: null,
    won: null,
    movesUsed: null,
    handsPlayed: null,
  } as DailyFritzAttemptRecord;
}

describe('historically trapped Daily Fritz attempts resume', () => {
  afterEach(() => {
    authUserMock.mockReset();
    getAttemptByIdMock.mockReset();
    getAttemptMock.mockReset();
    upsertAttemptMock.mockReset();
    getRunMock.mockReset();
  });

  for (const fixture of TRAPPED) {
    it(`serves a playable position for ${fixture.label}`, async () => {
      const attempt = buildAttempt(fixture);
      authUserMock.mockResolvedValue(fixture.userId);
      getAttemptMock.mockResolvedValue({ ...attempt });
      getAttemptByIdMock.mockResolvedValue({ ...attempt });
      getRunMock.mockResolvedValue(buildRun(fixture.runDate));
      upsertAttemptMock.mockImplementation(async (record: DailyFritzAttemptRecord) => ({ ...record }));

      const response = await makeHarness()('GET', '/api/daily-fritz/today');

      // No verification gate on the resume path: the player gets their run back.
      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.error).toBeUndefined();
      // The run is live and the player's next step is to play, not to clear a
      // verification banner. This is the assertion that would have failed
      // before PR #58.
      expect(response.body.attempt_status).toBe('started');
      expect(response.body.next_action).toBe('play_hand');
      expect(response.body.needs_completion).toBe(false);
      // The unverified state is still reported for observability — surfaced,
      // never used to withhold the run.
      expect(response.body.verification_status)
        .toBe(fixture.result.verification_status);
    });

    it(`keeps ${fixture.label} off the public leaderboard once completed`, () => {
      expect(isDailyFritzAttemptLeaderboardEligible({
        ...buildAttempt(fixture),
        status: 'completed',
      })).toBe(false);
    });
  }
});
