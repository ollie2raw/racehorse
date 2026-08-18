import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application } from 'express';
import {
  DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
  DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  FRITZ_POLICY_VERSION,
  GAME_RULES_VERSION,
  getFritzPolicyContract,
} from '@racehorse/game-core';
import { buildDailyFritzChallengeId } from '../../dailyFritzIdentity';
import { getDailyFritzSeed } from '../../dailyFritz';
import { buildDailyFritzRunFingerprint } from '../stores/dailyFritzStore';
import type { DailyFritzAttemptRecord, DailyFritzRunRecord } from '../stores/dailyFritzStore';
import {
  clearDailyFritzActiveCheckpoint,
  parseDailyFritzServerCheckpoint,
  readDailyFritzActiveCheckpoint,
  resolveDailyFritzResumeCheckpoint,
  writeDailyFritzActiveCheckpoint,
} from './dailyFritzCheckpointPolicy';

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

type Handler = (req: unknown, res: unknown) => unknown | Promise<unknown>;

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
    return { status, body: body as Record<string, unknown> };
  };
}

const RUN_DATE = '2026-08-10';
const USER_ID = 'user-1';
const ATTEMPT_ID = 'attempt-1';
const VERIFIED_MATCH_ID = 'verified-match-1';
const RUN_FINGERPRINT = 'run-fingerprint-1';

const GO_OUT_DEAL = {
  player_tiles: [{ low: 6, high: 6 }],
  fritz_tiles: [{ low: 0, high: 5 }],
  boneyard: [],
  locked: [],
};

function baseMatch() {
  return {
    handNumber: 1,
    handOver: false,
    gameOver: false,
    players: {
      you: { hand: [{ low: 6, high: 6 }], score: 0 },
      bot: { hand: [{ low: 0, high: 5 }], score: 0 },
    },
    boneyard: [],
    deadTiles: [],
  };
}

function buildCheckpoint(overrides: Record<string, unknown> = {}) {
  const now = '2026-08-10T12:00:00.000Z';
  return {
    schemaVersion: 9,
    attemptId: ATTEMPT_ID,
    runFingerprint: RUN_FINGERPRINT,
    gameNumber: 1,
    currentHandIndex: 0,
    authorityRevision: 3,
    lifecyclePhase: 'active_hand',
    checkpointRevision: 1,
    lastTransitionAt: now,
    startedAt: now,
    match: baseMatch(),
    handResult: null,
    movesUsed: 0,
    moveLog: [],
    transcript: null,
    verificationPhase: 'collecting',
    ...overrides,
  };
}

function baseAttempt(overrides: Partial<DailyFritzAttemptRecord> = {}): DailyFritzAttemptRecord {
  return {
    id: ATTEMPT_ID,
    runDate: RUN_DATE,
    userId: USER_ID,
    status: 'started',
    currentHandIndex: 0,
    currentGameNumber: 1,
    revision: 3,
    challengeId: null,
    challengeContractVersion: null,
    generationVersion: null,
    gameRulesVersion: null,
    transcriptProtocolVersion: null,
    fritzPolicyVersion: null,
    rankingVersion: null,
    authoritySchemaVersion: 1,
    startedAt: '2026-08-10T12:00:00.000Z',
    completedAt: null,
    verifiedMatchId: VERIFIED_MATCH_ID,
    completionHash: null,
    result: {
      active_game: { gameNumber: 1, you: 0, fritz: 0 },
      authority_contract: {
        transcriptProtocolVersion: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
        gameRulesVersion: GAME_RULES_VERSION,
        fritzPolicyVersion: FRITZ_POLICY_VERSION,
        fritzPolicyContract: getFritzPolicyContract(FRITZ_POLICY_VERSION),
        stateDigestVersion: DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
        stateDigestRequired: true,
        clientRelease: 'test',
        challengeId: buildDailyFritzChallengeId(RUN_DATE),
        runFingerprint: RUN_FINGERPRINT,
      },
      verification_status: 'in_progress',
    },
    finalScore: null,
    opponentScore: null,
    pointDiff: null,
    won: null,
    movesUsed: null,
    handsPlayed: null,
    ...overrides,
  };
}

function baseRun(): DailyFritzRunRecord {
  return {
    runDate: RUN_DATE,
    seed: getDailyFritzSeed(RUN_DATE),
    fritzTier: 'standard',
    dealSize: 7,
    winningScore: 100,
    status: 'live',
    handDeals: [GO_OUT_DEAL],
    generatedAt: '2026-08-10T00:00:00.000Z',
    invalidatedAt: null,
    metadata: { draw_winners_by_game: { '1': 'you' } },
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
}

describe('dailyFritzCheckpointPolicy', () => {
  it('accepts and rejects malformed checkpoints', () => {
    expect(parseDailyFritzServerCheckpoint(buildCheckpoint())).toBeTruthy();
    expect(parseDailyFritzServerCheckpoint({ ...buildCheckpoint(), schemaVersion: 8 })).toBeNull();
    expect(parseDailyFritzServerCheckpoint({
      ...buildCheckpoint(),
      match: { ...baseMatch(), handNumber: 2 },
    })).toBeNull();
  });

  it('returns resume checkpoint only when cursor matches', () => {
    const checkpoint = parseDailyFritzServerCheckpoint(buildCheckpoint())!;
    const attempt = baseAttempt({
      result: writeDailyFritzActiveCheckpoint(baseAttempt().result, checkpoint),
    });
    expect(resolveDailyFritzResumeCheckpoint(attempt, RUN_FINGERPRINT)).toEqual(checkpoint);
    expect(resolveDailyFritzResumeCheckpoint(
      { ...attempt, currentHandIndex: 1 },
      RUN_FINGERPRINT,
    )).toBeNull();
  });

  it('clears active checkpoint from attempt result', () => {
    const checkpoint = parseDailyFritzServerCheckpoint(buildCheckpoint())!;
    const withCheckpoint = writeDailyFritzActiveCheckpoint({}, checkpoint);
    expect(readDailyFritzActiveCheckpoint(withCheckpoint)).toEqual(checkpoint);
    expect(readDailyFritzActiveCheckpoint(clearDailyFritzActiveCheckpoint(withCheckpoint))).toBeNull();
  });
});

describe('dailyFritz checkpoint route', () => {
  const request = makeHarness();
  const previousFixturesFlag = process.env.DAILY_FRITZ_TEST_FIXTURES_ENABLED;

  beforeEach(() => {
    process.env.DAILY_FRITZ_TEST_FIXTURES_ENABLED = 'true';
    authUserMock.mockResolvedValue(USER_ID);
    upsertAttemptMock.mockImplementation(async (attempt: DailyFritzAttemptRecord) => attempt);
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (previousFixturesFlag === undefined) delete process.env.DAILY_FRITZ_TEST_FIXTURES_ENABLED;
    else process.env.DAILY_FRITZ_TEST_FIXTURES_ENABLED = previousFixturesFlag;
  });

  it('persists monotonic checkpoints and rejects stale writes', async () => {
    const checkpoint = buildCheckpoint({ checkpointRevision: 2 });
    const attempt = baseAttempt();
    getAttemptByIdMock.mockResolvedValue(attempt);

    const saved = await request('POST', '/api/daily-fritz/checkpoint', {
      body: {
        attempt_id: ATTEMPT_ID,
        verified_match_id: VERIFIED_MATCH_ID,
        checkpoint,
      },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.ok).toBe(true);
    expect(saved.body.checkpoint_revision).toBe(2);
    expect(upsertAttemptMock).toHaveBeenCalledTimes(1);

    const stored = readDailyFritzActiveCheckpoint(
      (upsertAttemptMock.mock.calls[0]?.[0] as DailyFritzAttemptRecord).result,
    );
    expect(stored?.checkpointRevision).toBe(2);

    getAttemptByIdMock.mockResolvedValue({
      ...attempt,
      result: writeDailyFritzActiveCheckpoint(attempt.result, parseDailyFritzServerCheckpoint(checkpoint)!),
    });
    const stale = await request('POST', '/api/daily-fritz/checkpoint', {
      body: {
        attempt_id: ATTEMPT_ID,
        verified_match_id: VERIFIED_MATCH_ID,
        checkpoint: buildCheckpoint({ checkpointRevision: 1 }),
      },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('stale_checkpoint');
  });

  it('returns resume_checkpoint from /start when a valid checkpoint exists', async () => {
    const run = baseRun();
    const runFingerprint = buildDailyFritzRunFingerprint(run);
    const checkpoint = parseDailyFritzServerCheckpoint(buildCheckpoint({
      checkpointRevision: 4,
      runFingerprint,
    }))!;
    const attempt = baseAttempt({
      result: writeDailyFritzActiveCheckpoint(baseAttempt().result, checkpoint),
    });
    wireStore(attempt, run);

    const started = await request('POST', '/api/daily-fritz/start', {
      body: {
        debug_date: RUN_DATE,
        verification_protocol_version: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
        game_rules_version: GAME_RULES_VERSION,
        fritz_policy_version: FRITZ_POLICY_VERSION,
        fritz_policy_contract: getFritzPolicyContract(FRITZ_POLICY_VERSION),
        state_digest_version: DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
        supported_transcript_protocol_versions: [DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION],
        supported_state_digest_versions: [DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION],
        supported_fritz_policies: [{
          version: FRITZ_POLICY_VERSION,
          contract: getFritzPolicyContract(FRITZ_POLICY_VERSION),
        }],
      },
    });
    expect(started.status).toBe(200);
    expect(started.body.resume_checkpoint?.checkpointRevision).toBe(4);
    expect(started.body.current_hand_index).toBe(0);
  });
});
