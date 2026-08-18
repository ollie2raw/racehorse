import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Application } from 'express';
import { buildDailyFritzChallengeId } from '../../dailyFritzIdentity';
import { getDailyFritzSeed } from '../../dailyFritz';
import { isDailyFritzAttemptLeaderboardEligible } from '../stores/dailyFritzStore';
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

type Handler = (req: any, res: any) => unknown | Promise<unknown>;

function makeHarness() {
  const routes = new Map<string, Handler>();
  const app = {
    get(path: string, handler: Handler) { routes.set(`GET ${path}`, handler); },
    post(path: string, handler: Handler) { routes.set(`POST ${path}`, handler); },
  };
  registerDailyFritzRoutes(app as unknown as Application);

  return async function request(
    method: 'GET' | 'POST',
    path: string,
    input: { body?: Record<string, unknown> } = {},
  ) {
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
    return { status, body: body as any };
  };
}

const RUN_DATE = '2026-08-10';
const USER_ID = 'user-1';
const ATTEMPT_ID = 'attempt-1';
const VERIFIED_MATCH_ID = 'verified-match-1';

const DEAL = {
  player_tiles: [{ low: 4, high: 4 }, { low: 1, high: 2 }],
  fritz_tiles: [{ low: 6, high: 6 }],
  boneyard: [{ low: 1, high: 3 }, { low: 2, high: 6 }],
  locked: [],
};

/** A transcript that cannot replay — stands in for every unrecoverable verifier rejection. */
function unverifiableTranscript() {
  return {
    protocolVersion: 2 as const,
    rulesVersion: 1 as never,
    fritzPolicyVersion: 2 as const,
    challengeId: buildDailyFritzChallengeId(RUN_DATE),
    attemptId: ATTEMPT_ID,
    gameNumber: 1 as const,
    handIndex: 0,
    actions: [
      { sequence: 0, actor: 'player' as const, kind: 'play' as const, tile: { low: 0, high: 0 }, position: 'left' as const },
    ],
  };
}

function buildRun(): DailyFritzRunRecord {
  return {
    runDate: RUN_DATE,
    seed: getDailyFritzSeed(RUN_DATE),
    fritzTier: 'standard',
    dealSize: 7,
    winningScore: 500,
    status: 'live',
    handDeals: [DEAL, DEAL],
    generatedAt: '2026-08-10T00:00:00.000Z',
    invalidatedAt: null,
    metadata: { draw_winners_by_game: { '1': 'you' } },
  } as DailyFritzRunRecord;
}

function buildAttempt(): DailyFritzAttemptRecord {
  return {
    id: ATTEMPT_ID,
    runDate: RUN_DATE,
    userId: USER_ID,
    status: 'started',
    currentHandIndex: 0,
    currentGameNumber: 1,
    revision: 1,
    challengeId: null,
    challengeContractVersion: null,
    generationVersion: null,
    gameRulesVersion: null,
    transcriptProtocolVersion: null,
    fritzPolicyVersion: null,
    rankingVersion: null,
    authoritySchemaVersion: 1,
    startedAt: '2026-08-10T00:00:00.000Z',
    completedAt: null,
    verifiedMatchId: VERIFIED_MATCH_ID,
    completionHash: null,
    result: null,
    finalScore: null,
    opponentScore: null,
    pointDiff: null,
    won: null,
    movesUsed: null,
    handsPlayed: null,
  } as DailyFritzAttemptRecord;
}

function wireStore(run: DailyFritzRunRecord) {
  let stored = buildAttempt();
  getAttemptByIdMock.mockImplementation(async (id: string, userId: string) =>
    (id === stored.id && userId === stored.userId ? { ...stored } : null));
  getAttemptMock.mockImplementation(async () => ({ ...stored }));
  upsertAttemptMock.mockImplementation(async (record: DailyFritzAttemptRecord) => {
    stored = { ...record, revision: record.revision + 1 };
    return { ...stored };
  });
  getRunMock.mockImplementation(async (date: string) => (date === run.runDate ? run : null));
  return { current: () => stored };
}

function nextHandBody(extra: Record<string, unknown> = {}) {
  return {
    attempt_id: ATTEMPT_ID,
    verified_match_id: VERIFIED_MATCH_ID,
    run_date: RUN_DATE,
    game_number: 1,
    completed_hand_index: 0,
    transcript: unverifiableTranscript(),
    completed_hand_scores: { you: 12, fritz: 0 },
    ...extra,
  };
}

describe('Daily Fritz never strands a player on an unverifiable hand', () => {
  afterEach(() => {
    authUserMock.mockReset();
    getAttemptByIdMock.mockReset();
    getAttemptMock.mockReset();
    upsertAttemptMock.mockReset();
    getRunMock.mockReset();
  });

  it('advances immediately on the first request when scores are present', async () => {
    authUserMock.mockResolvedValue(USER_ID);
    const store = wireStore(buildRun());
    const request = makeHarness();

    const response = await request('POST', '/api/daily-fritz/next-hand', { body: nextHandBody() });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.unverified).toBe(true);
    expect(response.body.hand).toBeTruthy();

    const attempt = store.current();
    expect(attempt.currentHandIndex).toBe(1);
    expect(attempt.result?.verification_status).toBe('rejected');
    expect(isDailyFritzAttemptLeaderboardEligible({
      ...attempt,
      status: 'completed',
    })).toBe(false);
  });

  it('still rejects when verification fails and no scores were sent', async () => {
    authUserMock.mockResolvedValue(USER_ID);
    wireStore(buildRun());
    const request = makeHarness();

    const response = await request('POST', '/api/daily-fritz/next-hand', {
      body: {
        ...nextHandBody(),
        completed_hand_scores: undefined,
      },
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('replays idempotently after an unverified advance', async () => {
    authUserMock.mockResolvedValue(USER_ID);
    const store = wireStore(buildRun());
    const request = makeHarness();

    await request('POST', '/api/daily-fritz/next-hand', { body: nextHandBody() });
    const replay = await request('POST', '/api/daily-fritz/next-hand', { body: nextHandBody() });

    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(store.current().currentHandIndex).toBe(1);
  });
});
