import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application } from 'express';
import { buildDailyFritzChallengeId } from '../../dailyFritzIdentity';
import { getDailyFritzSeed } from '../../dailyFritz';
import { isDailyFritzAttemptLeaderboardEligible } from '../stores/dailyFritzStore';
import type { DailyFritzAttemptRecord, DailyFritzRunRecord } from '../stores/dailyFritzStore';

const {
  authUserMock,
  getAttemptByIdMock,
  getAttemptMock,
  upsertAttemptMock,
  getRunMock,
  commitCommandMock,
} = vi.hoisted(() => {
  process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS = 'true';
  return {
  authUserMock: vi.fn(),
  getAttemptByIdMock: vi.fn(),
  getAttemptMock: vi.fn(),
  upsertAttemptMock: vi.fn(),
  getRunMock: vi.fn(),
  commitCommandMock: vi.fn(),
  };
});

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
    buildDailyFritzLeaderboard: vi.fn().mockResolvedValue([]),
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

vi.mock('../stores/dailyFritzCommandStore', async () => {
  const actual = await vi.importActual<typeof import('../stores/dailyFritzCommandStore')>(
    '../stores/dailyFritzCommandStore',
  );
  return {
    ...actual,
    commitDailyFritzAttemptCommand: commitCommandMock,
  };
});

vi.mock('../../shared/verifiedSinglePlayerMatch', () => ({
  getVerifiedSinglePlayerMatch: vi.fn().mockResolvedValue(null),
  persistVerifiedSinglePlayerMatch: vi.fn().mockResolvedValue(undefined),
}));

import { registerDailyFritzRoutes } from './dailyFritz';
import { resetDailyFritzMetricsForTests } from './dailyFritzMetrics';

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
    await handler({
      headers: {},
      params: {},
      query: {},
      body: input.body ?? {},
      method,
      path,
      get() { return undefined; },
    }, res);
    return { status, body: body as Record<string, unknown> };
  };
}

const RUN_DATE = '2026-08-19';
const USER_ID = 'user-legacy-unverified';
const ATTEMPT_ID = 'attempt-legacy-unverified';
const VERIFIED_MATCH_ID = 'verified-match-legacy-unverified';
const CHALLENGE_ID = buildDailyFritzChallengeId(RUN_DATE);

function buildRun(): DailyFritzRunRecord {
  return {
    runDate: RUN_DATE,
    seed: getDailyFritzSeed(RUN_DATE),
    fritzTier: 'standard',
    dealSize: 7,
    winningScore: 60,
    status: 'live',
    handDeals: [],
    generatedAt: '2026-08-19T00:00:00.000Z',
    invalidatedAt: null,
    metadata: null,
  };
}

function buildRejectedInstantSkunkAttempt(): DailyFritzAttemptRecord {
  const handDigest = 'a'.repeat(64);
  return {
    id: ATTEMPT_ID,
    runDate: RUN_DATE,
    userId: USER_ID,
    status: 'started',
    currentHandIndex: 6,
    currentGameNumber: 1,
    revision: 7,
    challengeId: CHALLENGE_ID,
    challengeContractVersion: 1,
    generationVersion: 1,
    gameRulesVersion: 1,
    transcriptProtocolVersion: 2,
    fritzPolicyVersion: 2,
    rankingVersion: 1,
    authoritySchemaVersion: 1,
    startedAt: '2026-08-19T22:00:00.000Z',
    completedAt: null,
    verifiedMatchId: VERIFIED_MATCH_ID,
    completionHash: null,
    finalScore: null,
    opponentScore: null,
    pointDiff: null,
    won: null,
    movesUsed: null,
    handsPlayed: null,
    result: {
      version: 2,
      format: 'best_of_3',
      playerGamesWon: 2,
      fritzGamesWon: 0,
      totalPointDiff: 34,
      setWinner: 'player',
      instantSkunk: true,
      skunkGameNumber: 1,
      verification_status: 'rejected',
      verification_protocol_version: 2,
      unverified_hands: [{
        game_number: 1,
        hand_index: 6,
        verifier_code: 'fritz_state_mismatch',
      }],
      games: [{
        gameNumber: 1,
        seed: `daily-fritz-${RUN_DATE}:game:1`,
        playerScore: 61,
        fritzScore: 27,
        playerWon: true,
        pointDiff: 34,
        movesUsed: 53,
        handsPlayed: 7,
        skunk: true,
        skunkBy: 'player',
        completedAt: '2026-08-19T22:10:24.923Z',
      }],
      authority: {
        version: 1,
        hands: [{
          gameNumber: 1,
          handIndex: 0,
          transcriptDigest: handDigest,
          actionCount: 10,
          playerScoreAfter: 9,
          fritzScoreAfter: 1,
          winner: 'player',
          verificationVersion: 2,
        }],
        games: [],
      },
    },
  };
}

function wireStore(initialAttempt: DailyFritzAttemptRecord, run: DailyFritzRunRecord) {
  let stored = initialAttempt;
  getAttemptByIdMock.mockImplementation(async (id: string, userId: string) =>
    (id === stored.id && userId === stored.userId ? { ...stored } : null));
  getAttemptMock.mockImplementation(async (runDate: string, userId: string) =>
    (runDate === stored.runDate && userId === stored.userId ? { ...stored } : null));
  upsertAttemptMock.mockImplementation(async (record: DailyFritzAttemptRecord) => {
    stored = { ...record };
    return { ...stored };
  });
  getRunMock.mockImplementation(async (date: string) => (date === run.runDate ? run : null));
  commitCommandMock.mockImplementation(async (input) => {
    expect(input.commandType).toBe('finalize_verified_attempt');
    expect(input.next.result?.verification_status).toBe('legacy_unverified');
    stored = {
      ...stored,
      status: 'completed',
      revision: stored.revision + 1,
      completedAt: '2026-08-19T22:20:00.000Z',
      finalScore: 2,
      opponentScore: 0,
      won: true,
      result: input.next.result,
    };
    return {
      outcome: 'committed',
      errorCode: null,
      replayed: false,
      committedRevision: stored.revision,
      response: { attempt_id: stored.id, revision: stored.revision, status: 'completed' },
    };
  });
  return { current: () => stored };
}

describe('Daily Fritz legacy_unverified finalize after rejected terminal hand', () => {
  beforeEach(() => {
    authUserMock.mockResolvedValue(USER_ID);
    resetDailyFritzMetricsForTests();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('completes unranked when setWinner is present, verification rejected, and no verified_games row exists', async () => {
    const attempt = buildRejectedInstantSkunkAttempt();
    const store = wireStore(attempt, buildRun());
    const request = makeHarness();

    const response = await request('POST', '/api/daily-fritz/complete', {
      body: {
        attempt_id: ATTEMPT_ID,
        verified_match_id: VERIFIED_MATCH_ID,
        run_date: RUN_DATE,
        completion_hash: 'client-hash-not-used',
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.rank).toBeNull();
    expect(commitCommandMock).toHaveBeenCalledTimes(1);
    const finalizeInput = commitCommandMock.mock.calls[0]?.[0];
    expect(finalizeInput?.next?.result?.verification_status).toBe('legacy_unverified');
    expect(finalizeInput?.next?.status).toBe('completed');

    const saved = store.current();
    expect(saved.status).toBe('completed');
    expect(isDailyFritzAttemptLeaderboardEligible(saved)).toBe(false);
  });
});
