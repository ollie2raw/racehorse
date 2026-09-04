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
import { buildHonestDailyFritzHandTranscript } from '../../testing/dailyFritzTranscriptDriver';
import type { DailyFritzAttemptRecord, DailyFritzRunRecord } from '../stores/dailyFritzStore';

// Invariant under test: once the server has verified a hand's transcript, the
// resulting score must never be silently discarded — including the hand that
// ends a Daily Fritz game (go-out or block crossing the winning score), and
// including a hand that was verified moments before an unrelated request on
// the same attempt fails with a 4xx. A hard refresh must be able to recover
// from server-persisted state alone.

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
    // getDailyFritzAttempt (by run date + user) is what the /start "resume"
    // route uses to look up an in-progress attempt for a brand-new client
    // request — i.e. a hard refresh with zero prior client state.
    getDailyFritzAttempt: getAttemptMock,
    upsertDailyFritzAttempt: upsertAttemptMock,
    getDailyFritzRun: getRunMock,
    // /start resumes via ensureDailyFritzRunForDate, not getDailyFritzRun.
    // Without this, CI (no Supabase) 500s while a laptop with env credentials can pass.
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

// Player has a single tile that matches nothing on the board yet — with an
// empty board any tile is a legal opener, so the player dominoes out on the
// very first action. Fritz is left holding {0,5} (5 pips).
const GO_OUT_DEAL = {
  player_tiles: [{ low: 6, high: 6 }],
  fritz_tiles: [{ low: 0, high: 5 }],
  boneyard: [],
  locked: [],
};

// Player opens with {0,0}. Fritz's {3,4} cannot follow a 0 end and the
// boneyard is empty, so Fritz passes; the player's remaining {1,2} also
// cannot follow, so the player passes too — two consecutive passes block the
// hand. The player holds fewer pips (3 vs 7) and wins the block.
const BLOCK_DEAL = {
  player_tiles: [{ low: 0, high: 0 }, { low: 1, high: 2 }],
  fritz_tiles: [{ low: 3, high: 4 }],
  boneyard: [],
  locked: [],
};

function buildRun(overrides: Partial<DailyFritzRunRecord> = {}): DailyFritzRunRecord {
  return {
    runDate: RUN_DATE,
    seed: getDailyFritzSeed(RUN_DATE),
    fritzTier: 'standard',
    dealSize: 7,
    winningScore: 1, // any nonzero hand score ends the game — isolates the persistence bug from scoring math
    status: 'live',
    handDeals: [GO_OUT_DEAL],
    generatedAt: '2026-08-10T00:00:00.000Z',
    invalidatedAt: null,
    // Pin the draw winner deterministically so the transcript we build
    // client-side matches what the server independently derives.
    metadata: { draw_winners_by_game: { '1': 'you' } },
    ...overrides,
  };
}

function buildAttempt(overrides: Partial<DailyFritzAttemptRecord> = {}): DailyFritzAttemptRecord {
  return {
    id: ATTEMPT_ID,
    runDate: RUN_DATE,
    userId: USER_ID,
    status: 'started',
    currentHandIndex: 0,
    currentGameNumber: 1,
    revision: 1,
    challengeId: null, // keeps the attempt on the non-transactional persistence path used by this fix
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
    ...overrides,
  };
}

function buildTranscriptFor(deal: typeof GO_OUT_DEAL, handIndex: number) {
  return buildHonestDailyFritzHandTranscript({
    challengeId: buildDailyFritzChallengeId(RUN_DATE),
    attemptId: ATTEMPT_ID,
    gameNumber: 1,
    handIndex,
    deal,
    drawWinner: 'you',
    winningScore: 1,
    dealSize: 7,
    playerScore: 0,
    fritzScore: 0,
    fritzTier: 'standard',
    fritzPolicyVersion: FRITZ_POLICY_VERSION,
  });
}

/** Simulates a fake DB row: attempt mutations from upsert are visible on the next read. */
function wireStore(initialAttempt: DailyFritzAttemptRecord, run: DailyFritzRunRecord) {
  let stored = initialAttempt;
  getAttemptByIdMock.mockImplementation(async (id: string, userId: string) =>
    (id === stored.id && userId === stored.userId ? { ...stored } : null));
  getAttemptMock.mockImplementation(async (runDate: string, userId: string) =>
    (runDate === stored.runDate && userId === stored.userId ? { ...stored } : null));
  upsertAttemptMock.mockImplementation(async (record: DailyFritzAttemptRecord) => {
    stored = { ...record, revision: record.revision + 1 };
    return { ...stored };
  });
  getRunMock.mockImplementation(async (date: string) => (date === run.runDate ? run : null));
  return {
    current: () => stored,
  };
}

// A hard refresh means a brand-new client process: no in-memory state, no
// knowledge of any prior /next-hand response. The only thing it can send is
// what a fresh page load sends — the same capability-advertising body the
// real client (client/src/dailyFritz/api.ts:startDailyFritz) always sends.
// POST /api/daily-fritz/start is the resume entrypoint the client actually
// calls in this situation (see continueSet/beginRun in
// useDailyFritzRunController.ts) — it is the only route whose response
// carries hand-level resume fields (current_hand_index, current_game_scores).
// GET /today deliberately carries no such fields (no current_hand_index,
// no active-game score) in its response shape, so it cannot answer either
// question below on its own.
function freshClientStartRequestBody() {
  return {
    // Only used so this test harness can pin the run date to the fixture
    // RUN_DATE instead of the real wall-clock date; the real client never
    // sends this. Requires DAILY_FRITZ_TEST_FIXTURES_ENABLED=true, set below.
    debug_date: RUN_DATE,
    verification_protocol_version: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
    game_rules_version: GAME_RULES_VERSION,
    fritz_policy_version: FRITZ_POLICY_VERSION,
    fritz_policy_contract: getFritzPolicyContract(FRITZ_POLICY_VERSION),
    state_digest_version: DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
    supported_transcript_protocol_versions: [1, DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION],
    supported_fritz_policies: ([1, 2, 3] as const).map((version) => ({
      version,
      contract: getFritzPolicyContract(version),
    })),
    supported_state_digest_versions: [DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION],
    client_release: 'test-client',
  };
}

describe('Daily Fritz: refresh reconstructs state from server storage alone', () => {
  const previousFixturesFlag = process.env.DAILY_FRITZ_TEST_FIXTURES_ENABLED;

  beforeEach(() => {
    // /start's run-date resolution otherwise falls back to the real
    // wall-clock date; pin it to our fixture RUN_DATE via debug_date.
    process.env.DAILY_FRITZ_TEST_FIXTURES_ENABLED = 'true';
  });

  afterEach(() => {
    authUserMock.mockReset();
    getAttemptByIdMock.mockReset();
    getAttemptMock.mockReset();
    upsertAttemptMock.mockReset();
    getRunMock.mockReset();
    if (previousFixturesFlag === undefined) delete process.env.DAILY_FRITZ_TEST_FIXTURES_ENABLED;
    else process.env.DAILY_FRITZ_TEST_FIXTURES_ENABLED = previousFixturesFlag;
  });

  it('mid-hand refresh: a fresh client resuming via /start sees the hand index and score that /next-hand actually persisted, not stale/default values', async () => {
    authUserMock.mockResolvedValue(USER_ID);
    // High winning score: hand 0 completes but does not end the game, so we
    // land mid-attempt (hand 1 in progress) rather than in the terminal path.
    const run = buildRun({ winningScore: 100, handDeals: [GO_OUT_DEAL] });
    const store = wireStore(buildAttempt(), run);
    const { transcript } = buildTranscriptFor(GO_OUT_DEAL, 0);

    const request = makeHarness();
    const nextHandResponse = await request('POST', '/api/daily-fritz/next-hand', {
      body: {
        attempt_id: ATTEMPT_ID,
        verified_match_id: VERIFIED_MATCH_ID,
        run_date: RUN_DATE,
        game_number: 1,
        completed_hand_index: 0,
        transcript,
      },
    });
    expect(nextHandResponse.status).toBe(200);
    expect(nextHandResponse.body.current_hand_index).toBe(1);

    // What was actually written to durable storage — the ground truth a
    // hard-refreshed client has zero visibility into directly.
    const persisted = store.current();
    expect(persisted.currentHandIndex).toBe(1);
    const persistedScores = (persisted.result as any)?.active_game;
    expect(persistedScores).toMatchObject({ game_number: 1 });
    // Guard against a vacuous pass: the score must actually be non-zero here
    // (the player dominoes out immediately against a 5-pip Fritz hand), so a
    // reconstruction bug that silently defaults to {you:0, fritz:0} would be
    // caught rather than accidentally matching.
    expect(persistedScores.you > 0 || persistedScores.fritz > 0).toBe(true);

    // Simulate a hard refresh: a brand-new request, with no client-held
    // memory of the /next-hand response above — only what a fresh page load
    // always sends.
    const resumeResponse = await request('POST', '/api/daily-fritz/start', {
      body: freshClientStartRequestBody(),
    });

    expect(resumeResponse.status).toBe(200);
    expect(resumeResponse.body.current_hand_index).toBe(persisted.currentHandIndex);
    expect(resumeResponse.body.current_game_scores).toEqual({
      you: persistedScores.you,
      fritz: persistedScores.fritz,
    });
    // And it must match what /next-hand itself reported in the moment, i.e.
    // reconstruction from storage alone reproduces the live response.
    expect(resumeResponse.body.current_game_scores).toEqual(nextHandResponse.body.current_game_scores);
  });

  it('game-ending hand survives a 409-then-refresh: a fresh client resuming via /start still sees the terminal hand score, before record-game ever runs', async () => {
    authUserMock.mockResolvedValue(USER_ID);
    const run = buildRun({ handDeals: [GO_OUT_DEAL] }); // winningScore: 1 — first hand ends the game
    const store = wireStore(buildAttempt(), run);
    const { transcript, terminalState } = buildTranscriptFor(GO_OUT_DEAL, 0);
    expect(terminalState.gameOver).toBe(true);

    const request = makeHarness();
    const nextHandResponse = await request('POST', '/api/daily-fritz/next-hand', {
      body: {
        attempt_id: ATTEMPT_ID,
        verified_match_id: VERIFIED_MATCH_ID,
        run_date: RUN_DATE,
        game_number: 1,
        completed_hand_index: 0,
        transcript,
      },
    });
    expect(nextHandResponse.status).toBe(409);

    const persisted = store.current();
    const ledgerHands = (persisted.result as any)?.authority?.hands ?? [];
    expect(ledgerHands).toHaveLength(1);
    const persistedScores = (persisted.result as any)?.active_game;
    expect(persistedScores).toMatchObject({
      game_number: 1,
      you: ledgerHands[0].playerScoreAfter,
      fritz: ledgerHands[0].fritzScoreAfter,
    });
    expect(persistedScores.you > 0 || persistedScores.fritz > 0).toBe(true);

    // No call to /record-game here — we're proving the score survives a
    // refresh that happens strictly between the 409 and finalization.
    const resumeResponse = await request('POST', '/api/daily-fritz/start', {
      body: freshClientStartRequestBody(),
    });

    expect(resumeResponse.status).toBe(200);
    // The hand did not advance (record-game still expects hand 0).
    expect(resumeResponse.body.current_hand_index).toBe(0);
    // But the verified terminal hand's score must be visible to the fresh
    // client — it is not held only in the 409 response no one may have seen.
    expect(resumeResponse.body.current_game_scores).toEqual({
      you: ledgerHands[0].playerScoreAfter,
      fritz: ledgerHands[0].fritzScoreAfter,
    });
    expect(resumeResponse.body.current_game_scores).toEqual({
      you: persistedScores.you,
      fritz: persistedScores.fritz,
    });
  });
});

describe('Daily Fritz: verified hand scores survive game-ending 409s and later 4xxs', () => {
  afterEach(() => {
    authUserMock.mockReset();
    getAttemptByIdMock.mockReset();
    getAttemptMock.mockReset();
    upsertAttemptMock.mockReset();
    getRunMock.mockReset();
  });

  it('go-out: persists the verified terminal hand before rejecting next-hand, so record-game can finalize it without losing the score', async () => {
    authUserMock.mockResolvedValue(USER_ID);
    const run = buildRun({ handDeals: [GO_OUT_DEAL] });
    const store = wireStore(buildAttempt(), run);
    const { transcript, terminalState } = buildTranscriptFor(GO_OUT_DEAL, 0);
    expect(terminalState.gameOver).toBe(true);

    const request = makeHarness();
    const nextHandResponse = await request('POST', '/api/daily-fritz/next-hand', {
      body: {
        attempt_id: ATTEMPT_ID,
        verified_match_id: VERIFIED_MATCH_ID,
        run_date: RUN_DATE,
        game_number: 1,
        completed_hand_index: 0,
        transcript,
      },
    });

    // The endpoint still tells the client to finalize via /record-game...
    expect(nextHandResponse.status).toBe(409);
    // ...but the verified score must already be durable — not just held in
    // client memory — so a hard refresh here cannot lose it.
    const persisted = store.current();
    expect(upsertAttemptMock).toHaveBeenCalledTimes(1);
    const ledgerHands = (persisted.result as any)?.authority?.hands ?? [];
    expect(ledgerHands).toHaveLength(1);
    expect(ledgerHands[0]).toMatchObject({ gameNumber: 1, handIndex: 0 });
    expect((persisted.result as any)?.active_game).toMatchObject({
      game_number: 1,
      you: ledgerHands[0].playerScoreAfter,
      fritz: ledgerHands[0].fritzScoreAfter,
    });
    // currentHandIndex must NOT advance — record-game expects this same hand.
    expect(persisted.currentHandIndex).toBe(0);

    const recordGameResponse = await request('POST', '/api/daily-fritz/record-game', {
      body: {
        attempt_id: ATTEMPT_ID,
        verified_match_id: VERIFIED_MATCH_ID,
        run_date: RUN_DATE,
        game_number: 1,
        transcript,
      },
    });

    expect(recordGameResponse.status).toBe(200);
    expect(recordGameResponse.body.ok).toBe(true);
    const game = recordGameResponse.body.set_result.games[0];
    expect(game.playerWon).toBe(true);
    // Fritz scored 0 in the ended game (only hand played) — under the 30-point
    // skunk threshold, so this also proves the skunk scoring path survives
    // the deferred-persistence hand-off between next-hand and record-game.
    expect(game.fritzScore).toBeLessThan(30);
    expect(game.skunk).toBe(true);
    expect(game.skunkBy).toBe('player');

    // The hand must be recorded exactly once — no duplicate ledger entry from
    // the earlier defensive persist plus record-game's own write.
    const finalPersisted = store.current();
    const finalLedgerHands = (finalPersisted.result as any)?.authority?.hands ?? [];
    expect(finalLedgerHands).toHaveLength(1);
    expect(game.handsPlayed).toBe(1);
  });

  it('/complete 4xx after game 1 is already verified never discards it or marks the attempt abandoned — the single most important unresolved claim in this pillar, forced and observed directly', async () => {
    authUserMock.mockResolvedValue(USER_ID);
    // A go-out at winningScore: 1 skunks Fritz to 0 in game 1, which — a
    // real Daily Fritz rule, not a test artifact — instantly decides the
    // whole 2-of-3 set (instant-skunk). That actually makes /complete
    // succeed here, so it can't be this test's failure trigger. Use a
    // mismatched verified_match_id instead: a realistic failure mode (a
    // stale/retried request carrying the wrong session id) that reliably
    // 4xxs regardless of set-completion state, while game 1's data is
    // already verified and persisted underneath it.
    const run = buildRun({ handDeals: [GO_OUT_DEAL] });
    const store = wireStore(buildAttempt(), run);
    const { transcript } = buildTranscriptFor(GO_OUT_DEAL, 0);

    const request = makeHarness();
    await request('POST', '/api/daily-fritz/next-hand', {
      body: {
        attempt_id: ATTEMPT_ID,
        verified_match_id: VERIFIED_MATCH_ID,
        run_date: RUN_DATE,
        game_number: 1,
        completed_hand_index: 0,
        transcript,
      },
    });
    const recordGameResponse = await request('POST', '/api/daily-fritz/record-game', {
      body: {
        attempt_id: ATTEMPT_ID,
        verified_match_id: VERIFIED_MATCH_ID,
        run_date: RUN_DATE,
        game_number: 1,
        transcript,
      },
    });
    expect(recordGameResponse.status).toBe(200);

    // Ground truth: game 1 is verified and persisted (the attempt's status
    // may already reflect a decided set here, per the instant-skunk rule
    // above — that's fine, this test's claim doesn't depend on it).
    const beforePrematureComplete = store.current();
    const gamesBefore = (beforePrematureComplete.result as any)?.games ?? [];
    expect(gamesBefore).toHaveLength(1);
    expect(gamesBefore[0].playerWon).toBe(true);
    const upsertCallsBeforePrematureComplete = upsertAttemptMock.mock.calls.length;

    // Force a real 4xx on /complete: a mismatched verified_match_id hits the
    // server's own "Verified match does not match this attempt." guard —
    // this is a real failure path (e.g. a stale retried request), not a
    // synthetic error injection.
    const prematureCompleteResponse = await request('POST', '/api/daily-fritz/complete', {
      body: {
        attempt_id: ATTEMPT_ID,
        verified_match_id: 'some-other-verified-match-id',
        run_date: RUN_DATE,
        completion_hash: 'not-a-real-hash',
      },
    });
    expect(prematureCompleteResponse.status).toBe(403);

    // The definitive answer: nothing was written as a result of this failure
    // (no additional upsert call at all — /complete's 4xx exit paths return
    // before ever mutating the in-memory attempt object, let alone
    // persisting it), the attempt is still 'started' (never 'abandoned' —
    // /complete contains no code path that ever sets that status; only the
    // separate POST /abandon endpoint does, and nothing calls it here), and
    // game 1's verified result is byte-for-byte unchanged.
    expect(upsertAttemptMock.mock.calls.length).toBe(upsertCallsBeforePrematureComplete);
    const afterPrematureComplete = store.current();
    expect(afterPrematureComplete.status).toBe('started');
    expect(afterPrematureComplete).toEqual(beforePrematureComplete);
    const gamesAfter = (afterPrematureComplete.result as any)?.games ?? [];
    expect(gamesAfter).toEqual(gamesBefore);
  });

  it('block: persists the verified terminal hand before rejecting next-hand, so record-game can finalize it without losing the score', async () => {
    authUserMock.mockResolvedValue(USER_ID);
    const run = buildRun({ handDeals: [BLOCK_DEAL] });
    const store = wireStore(buildAttempt(), run);
    const { transcript, terminalState } = buildTranscriptFor(BLOCK_DEAL, 0);
    expect(terminalState.gameOver).toBe(true);

    const request = makeHarness();
    const nextHandResponse = await request('POST', '/api/daily-fritz/next-hand', {
      body: {
        attempt_id: ATTEMPT_ID,
        verified_match_id: VERIFIED_MATCH_ID,
        run_date: RUN_DATE,
        game_number: 1,
        completed_hand_index: 0,
        transcript,
      },
    });
    expect(nextHandResponse.status).toBe(409);

    const persisted = store.current();
    const ledgerHands = (persisted.result as any)?.authority?.hands ?? [];
    expect(ledgerHands).toHaveLength(1);
    expect(ledgerHands[0].reason).toBe('blocked');
    expect((persisted.result as any)?.active_game.you).toBe(ledgerHands[0].playerScoreAfter);

    const recordGameResponse = await request('POST', '/api/daily-fritz/record-game', {
      body: {
        attempt_id: ATTEMPT_ID,
        verified_match_id: VERIFIED_MATCH_ID,
        run_date: RUN_DATE,
        game_number: 1,
        transcript,
      },
    });
    expect(recordGameResponse.status).toBe(200);
    expect(recordGameResponse.body.set_result.games[0].playerWon).toBe(true);
  });

  it('a later 400 on the same attempt does not discard an already-persisted verified hand', async () => {
    authUserMock.mockResolvedValue(USER_ID);
    // winningScore is high enough that this single hand does not end the
    // game, so a normal (non-terminal) next-hand success path persists it.
    const run = buildRun({ winningScore: 100, handDeals: [GO_OUT_DEAL] });
    const store = wireStore(buildAttempt(), run);
    const { transcript } = buildTranscriptFor(GO_OUT_DEAL, 0);

    const request = makeHarness();
    const firstResponse = await request('POST', '/api/daily-fritz/next-hand', {
      body: {
        attempt_id: ATTEMPT_ID,
        verified_match_id: VERIFIED_MATCH_ID,
        run_date: RUN_DATE,
        game_number: 1,
        completed_hand_index: 0,
        transcript,
      },
    });
    expect(firstResponse.status).toBe(200);
    const afterFirstHand = store.current();
    const handsAfterFirst = (afterFirstHand.result as any)?.authority?.hands ?? [];
    expect(handsAfterFirst).toHaveLength(1);
    expect(afterFirstHand.currentHandIndex).toBe(1);
    const upsertCallsAfterFirst = upsertAttemptMock.mock.calls.length;

    // Now provoke a 400 on the *next* request against the same attempt (a
    // malformed transcript for the following hand).
    const badResponse = await request('POST', '/api/daily-fritz/next-hand', {
      body: {
        attempt_id: ATTEMPT_ID,
        verified_match_id: VERIFIED_MATCH_ID,
        run_date: RUN_DATE,
        game_number: 1,
        completed_hand_index: 1,
        transcript: { not: 'a valid transcript' },
      },
    });
    expect(badResponse.status).toBe(400);

    // The previously verified hand and its score must still be intact — the
    // 400 must not have triggered any additional write, let alone a reset.
    expect(upsertAttemptMock.mock.calls.length).toBe(upsertCallsAfterFirst);
    const afterBadRequest = store.current();
    expect(afterBadRequest.currentHandIndex).toBe(1);
    const handsAfterBad = (afterBadRequest.result as any)?.authority?.hands ?? [];
    expect(handsAfterBad).toHaveLength(1);
    expect(handsAfterBad[0]).toEqual(handsAfterFirst[0]);
  });
});
