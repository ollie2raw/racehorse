import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application } from 'express';
import {
  DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  FRITZ_POLICY_VERSION,
  GAME_RULES_VERSION,
  getFritzPolicyContract,
} from '@racehorse/game-core';
import { buildDailyFritzChallengeId } from '../../dailyFritzIdentity';
import { getDailyFritzSeed } from '../../dailyFritz';
import type { DailyFritzAttemptRecord, DailyFritzRunRecord } from '../stores/dailyFritzStore';

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
import { getDailyFritzMetrics, resetDailyFritzMetricsForTests } from './dailyFritzMetrics';

type Handler = (req: unknown, res: unknown) => unknown | Promise<unknown>;

function makeHarness() {
  const routes = new Map<string, Handler>();
  const app = {
    get(path: string, handler: Handler) { routes.set(`GET ${path}`, handler); },
    post(path: string, handler: Handler) { routes.set(`POST ${path}`, handler); },
  };
  registerDailyFritzRoutes(app as unknown as Application);
  return async function request(method: 'GET' | 'POST', path: string, input: { body?: Record<string, unknown> } = {}) {
    const handler = routes.get(`${method} ${path}`);
    if (!handler) throw new Error(`Missing route ${method} ${path}`);
    let status = 200;
    let body: unknown;
    const res = {
      status(code: number) { status = code; return res; },
      json(value: unknown) { body = value; return res; },
      setHeader() { return res; },
      once() { return res; },
    };
    await handler({ headers: {}, params: {}, query: {}, body: input.body ?? {}, method, path, get() { return undefined; } }, res);
    return { status, body: body as Record<string, unknown> };
  };
}

const RUN_DATE = '2026-08-10';
const USER_ID = 'user-1';
const ATTEMPT_ID = 'attempt-1';
const VERIFIED_MATCH_ID = 'verified-match-1';

function buildAttempt(): DailyFritzAttemptRecord {
  return {
    id: ATTEMPT_ID,
    runDate: RUN_DATE,
    userId: USER_ID,
    status: 'started',
    currentHandIndex: 3,
    currentGameNumber: 2,
    revision: 4,
    challengeId: null,
    challengeContractVersion: null,
    generationVersion: null,
    gameRulesVersion: null,
    transcriptProtocolVersion: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
    fritzPolicyVersion: FRITZ_POLICY_VERSION,
    rankingVersion: null,
    authoritySchemaVersion: 1,
    startedAt: '2026-08-10T00:00:00.000Z',
    completedAt: null,
    verifiedMatchId: VERIFIED_MATCH_ID,
    completionHash: null,
    result: {
      version: 2,
      format: 'best_of_3',
      playerGamesWon: 0,
      fritzGamesWon: 1,
      totalPointDiff: -10,
      games: [{
        gameNumber: 1,
        seed: 'seed-1',
        playerWon: false,
        playerScore: 40,
        fritzScore: 60,
        pointDiff: -20,
        movesUsed: 12,
        handsPlayed: 4,
        completedAt: '2026-08-10T10:00:00.000Z',
      }],
      authority_contract: {
        transcriptProtocolVersion: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
        gameRulesVersion: GAME_RULES_VERSION,
        fritzPolicyVersion: FRITZ_POLICY_VERSION,
        fritzPolicyContract: getFritzPolicyContract(FRITZ_POLICY_VERSION),
        stateDigestVersion: 1,
        stateDigestRequired: true,
        clientRelease: 'test',
        challengeId: buildDailyFritzChallengeId(RUN_DATE),
        runFingerprint: 'fp',
      },
      verification_status: 'in_progress',
      active_game: { game_number: 2, you: 60, fritz: 34 },
    },
    finalScore: null,
    opponentScore: null,
    pointDiff: null,
    won: null,
    movesUsed: null,
    handsPlayed: null,
  };
}

function buildRun(): DailyFritzRunRecord {
  return {
    runDate: RUN_DATE,
    seed: getDailyFritzSeed(RUN_DATE),
    fritzTier: 'standard',
    dealSize: 7,
    winningScore: 100,
    status: 'live',
    handDeals: [],
    generatedAt: '2026-08-10T00:00:00.000Z',
    invalidatedAt: null,
    metadata: { draw_winners_by_game: { '2': 'you' } },
  };
}

describe('record-game advance-first with legacy scores', () => {
  const request = makeHarness();

  beforeEach(() => {
    resetDailyFritzMetricsForTests();
    authUserMock.mockResolvedValue(USER_ID);
    process.env.DAILY_FRITZ_TEST_FIXTURES_ENABLED = 'true';
    const attempt = buildAttempt();
    getAttemptByIdMock.mockImplementation(async () => ({ ...attempt }));
    getAttemptMock.mockImplementation(async () => ({ ...attempt }));
    upsertAttemptMock.mockImplementation(async (record: DailyFritzAttemptRecord) => ({ ...record, revision: record.revision + 1 }));
    getRunMock.mockImplementation(async () => buildRun());
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.DAILY_FRITZ_TEST_FIXTURES_ENABLED;
  });

  it('records game 2 from legacy scores when transcript verification fails', async () => {
    const response = await request('POST', '/api/daily-fritz/record-game', {
      body: {
        attempt_id: ATTEMPT_ID,
        verified_match_id: VERIFIED_MATCH_ID,
        run_date: RUN_DATE,
        game_number: 2,
        player_score: 60,
        fritz_score: 34,
        moves_used: 18,
        hands_played: 4,
        transcript: {
          protocolVersion: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
          rulesVersion: GAME_RULES_VERSION,
          fritzPolicyVersion: FRITZ_POLICY_VERSION,
          fritzPolicyContract: getFritzPolicyContract(FRITZ_POLICY_VERSION),
          stateDigestVersion: 1,
          clientRelease: 'test',
          challengeId: buildDailyFritzChallengeId(RUN_DATE),
          attemptId: ATTEMPT_ID,
          gameNumber: 2,
          handIndex: 3,
          actions: [{ sequence: 0, actor: 'player', kind: 'pass' }],
        },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    const games = (response.body.set_result as { games: Array<{ gameNumber: number; playerScore: number; fritzScore: number }> }).games;
    expect(games).toHaveLength(2);
    expect(games[1]).toMatchObject({ gameNumber: 2, playerScore: 60, fritzScore: 34 });
    expect(getDailyFritzMetrics().verification_bypassed.total).toBeGreaterThan(0);
    expect(response.body.next_game_number).toBe(3);
  });
});
