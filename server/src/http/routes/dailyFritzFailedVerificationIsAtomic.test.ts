/**
 * next-hand drives the real route with REAL generated hands (independent oracle + real client transcript path).
 *
 * A verification that fails (and carries no claimed scores) must change nothing: no hand advance, no ledger row, no write at all,
 * and an honest retry must then succeed exactly once. The documented never-strand path (claimed scores + a transcript that fails
 * verification) must advance the player but leave the run sticky-unranked: never verified, never leaderboard- or streak-eligible.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application } from 'express';
import { compareStates } from '../../../../packages/game-core/src/__tests__/support/engineHarness';
import { getDailyFritzSeed } from '../../dailyFritz';
import { ownerSpec, playHand, runClientLeg, type Spec } from '../../../test/support/dailyFritzVerifierOracle';
import {
  isDailyFritzAttemptLeaderboardEligible,
  isDailyFritzAttemptStreakEligible,
  type DailyFritzAttemptRecord,
  type DailyFritzRunRecord,
} from '../stores/dailyFritzStore';

const { authUserMock, getAttemptByIdMock, getAttemptMock, upsertAttemptMock, getRunMock, commitMock } = vi.hoisted(() => ({
  authUserMock: vi.fn(),
  getAttemptByIdMock: vi.fn(),
  getAttemptMock: vi.fn(),
  upsertAttemptMock: vi.fn(),
  getRunMock: vi.fn(),
  commitMock: vi.fn(),
}));

vi.mock('../../platform/auth/supabaseAuth', () => ({
  getAuthenticatedUserId: authUserMock,
  getAuthenticatedUserIdFromToken: vi.fn().mockResolvedValue(null),
}));
vi.mock('../stores/dailyFritzStore', async () => {
  const actual = await vi.importActual<typeof import('../stores/dailyFritzStore')>('../stores/dailyFritzStore');
  return { ...actual, getDailyFritzAttemptById: getAttemptByIdMock, getDailyFritzAttempt: getAttemptMock, upsertDailyFritzAttempt: upsertAttemptMock, getDailyFritzRun: getRunMock, ensureDailyFritzRunForDate: getRunMock };
});
vi.mock('../stores/dailyFritzEventStore', async () => {
  const actual = await vi.importActual<typeof import('../stores/dailyFritzEventStore')>('../stores/dailyFritzEventStore');
  return { ...actual, recordDailyFritzEvent: vi.fn().mockResolvedValue(undefined) };
});
vi.mock('../stores/dailyFritzCommandStore', async () => {
  const actual = await vi.importActual<typeof import('../stores/dailyFritzCommandStore')>('../stores/dailyFritzCommandStore');
  return { ...actual, commitDailyFritzAttemptCommand: commitMock };
});
vi.mock('../../social/activityWriter', () => ({ writeDailyFritzGameActivity: vi.fn().mockResolvedValue(undefined) }));

import { registerDailyFritzRoutes } from './dailyFritz';

type Handler = (req: unknown, res: unknown) => unknown | Promise<unknown>;

function makeHarness() {
  const routes = new Map<string, Handler>();
  const app = {
    get(path: string, handler: Handler) { routes.set(`GET ${path}`, handler); },
    post(path: string, handler: Handler) { routes.set(`POST ${path}`, handler); },
  };
  registerDailyFritzRoutes(app as unknown as Application);
  return async function post(path: string, body: Record<string, unknown>) {
    const handler = routes.get(`POST ${path}`);
    if (!handler) throw new Error(`Missing route POST ${path}`);
    let status = 200;
    let responseBody: unknown;
    const res = {
      status(code: number) { status = code; return res; },
      json(value: unknown) { responseBody = value; return res; },
      setHeader() { return res; },
      once() { return res; },
    };
    await handler({ headers: {}, params: {}, query: {}, body, method: 'POST', path, get() { return undefined; } }, res);
    return { status, body: responseBody as Record<string, unknown> };
  };
}

const USER = 'user-suite';
const MATCH = 'verified-match-suite';
let spec: Spec;
let stored: DailyFritzAttemptRecord;

const buildRun = (): DailyFritzRunRecord => ({
  runDate: spec.runDate, seed: getDailyFritzSeed(spec.runDate), fritzTier: spec.tier, dealSize: spec.dealSize, winningScore: spec.winningScore,
  status: 'live', handDeals: [], generatedAt: '2026-01-01T00:00:00.000Z', invalidatedAt: null, metadata: null,
} as unknown as DailyFritzRunRecord);

const buildAttempt = (): DailyFritzAttemptRecord => ({
  id: spec.attemptId, runDate: spec.runDate, userId: USER, status: 'started', currentHandIndex: 0, currentGameNumber: spec.gameNumber, revision: 1,
  challengeId: null, // non-transactional path: the same verification + persistence logic, without the DB command store
  verifiedMatchId: MATCH, completedAt: null, completionHash: null, finalScore: null, opponentScore: null, pointDiff: null, movesUsed: null, handsPlayed: null,
  result: {
    version: 2, format: 'best_of_3', playerGamesWon: 0, fritzGamesWon: 0, totalPointDiff: 0, games: [],
    verification_status: 'in_progress', verification_protocol_version: 2,
  },
} as unknown as DailyFritzAttemptRecord);

beforeEach(() => {
  vi.clearAllMocks();
  spec = ownerSpec('daily-fritz-verifier-v1:atomic', 3);
  stored = buildAttempt();
  authUserMock.mockResolvedValue(USER);
  getRunMock.mockImplementation(async () => buildRun());
  getAttemptByIdMock.mockImplementation(async () => JSON.parse(JSON.stringify(stored)));
  getAttemptMock.mockImplementation(async () => JSON.parse(JSON.stringify(stored)));
  upsertAttemptMock.mockImplementation(async (record: DailyFritzAttemptRecord) => { stored = JSON.parse(JSON.stringify(record)); return JSON.parse(JSON.stringify(stored)); });
});

const body = (extra: Record<string, unknown>) => ({ attempt_id: spec.attemptId, verified_match_id: MATCH, run_date: spec.runDate, game_number: spec.gameNumber, completed_hand_index: 0, ...extra });
const ledger = () => ((stored.result as { authority?: { hands?: unknown[] } } | null)?.authority?.hands ?? []) as Array<{ playerScoreAfter: number; fritzScoreAfter: number; handIndex: number }>;

describe('a failed verification is atomic, and an honest retry then succeeds exactly once', () => {
  it('tampered transcript (no claimed scores): refused, nothing persisted, attempt unchanged', async () => {
    const played = playHand(spec);
    const honest = runClientLeg(played).transcript;
    const tampered = { ...honest, actions: honest.actions.slice(0, -1) }; // truncated: does not complete the hand
    const before = JSON.stringify(stored);
    const response = await makeHarness()('/api/daily-fritz/next-hand', body({ transcript: tampered }));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(upsertAttemptMock).not.toHaveBeenCalled();
    expect(commitMock).not.toHaveBeenCalled();
    expect(JSON.stringify(stored)).toBe(before);
    expect(stored.currentHandIndex).toBe(0);
    expect(ledger()).toHaveLength(0);
  });

  it('malformed transcript (no claimed scores): refused, nothing persisted', async () => {
    const before = JSON.stringify(stored);
    const response = await makeHarness()('/api/daily-fritz/next-hand', body({ transcript: { protocolVersion: 99, actions: [] } }));
    expect(response.status).toBe(400);
    expect(upsertAttemptMock).not.toHaveBeenCalled();
    expect(JSON.stringify(stored)).toBe(before);
  });

  it('after refusals, the honest transcript advances once, records the oracle\'s result, and a replay is idempotent', async () => {
    const played = playHand(spec);
    const honest = runClientLeg(played).transcript;
    const post = makeHarness();
    // failed attempts first (they must not poison the retry)
    await post('/api/daily-fritz/next-hand', body({ transcript: { ...honest, actions: honest.actions.slice(0, -1) } }));
    await post('/api/daily-fritz/next-hand', body({ transcript: { ...honest, attemptId: `${spec.attemptId}:x` } }));
    expect(stored.currentHandIndex).toBe(0);

    const first = await post('/api/daily-fritz/next-hand', body({ transcript: honest }));
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(stored.currentHandIndex).toBe(1);
    expect(ledger()).toHaveLength(1);
    expect(ledger()[0]).toMatchObject({ handIndex: 0, playerScoreAfter: played.oracle.scores.get('player'), fritzScoreAfter: played.oracle.scores.get('fritz') });
    expect((stored.result as { verification_status?: string }).verification_status).not.toBe('rejected');
    const writes = upsertAttemptMock.mock.calls.length;

    const replay = await post('/api/daily-fritz/next-hand', body({ transcript: honest }));
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(ledger()).toHaveLength(1);
    expect(stored.currentHandIndex).toBe(1);
    expect(upsertAttemptMock.mock.calls.length).toBe(writes);
    void compareStates;
  });

  it('never-strand: claimed scores + a transcript that fails verification advance the player, but the run is sticky-unranked', async () => {
    const played = playHand(spec);
    const honest = runClientLeg(played).transcript;
    const tampered = { ...honest, actions: honest.actions.slice(0, -1) };
    const response = await makeHarness()('/api/daily-fritz/next-hand', body({ transcript: tampered, completed_hand_scores: { you: 7, fritz: 3 } }));
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.unverified).toBe(true);
    const result = stored.result as Record<string, unknown>;
    expect(result.verification_status).toBe('rejected');
    expect(Array.isArray(result.unverified_hands) && (result.unverified_hands as unknown[]).length).toBe(1);
    expect(ledger()).toHaveLength(0); // the claim never enters the verified ledger
    const completed = { status: 'completed', result } as Pick<DailyFritzAttemptRecord, 'status' | 'result'>;
    expect(isDailyFritzAttemptLeaderboardEligible(completed)).toBe(false);
    expect(isDailyFritzAttemptStreakEligible(completed)).toBe(false);
  });
});
