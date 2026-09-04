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
import type { DailyFritzAttemptRecord, DailyFritzRunRecord } from '../stores/dailyFritzStore';
// This is the REAL client-side transcript builder (client/src/dailyFritz/dailyFritzTranscript.ts),
// imported cross-package on purpose: the production incident is a client-side transcript
// construction bug, so the repro must exercise the real client function, not a
// server-authored "honest" driver (server/src/testing/dailyFritzTranscriptDriver.ts always
// logs one transcript action per real applyGameCommand call and therefore can never
// reproduce this bug — see root-cause note below).
import { buildDailyFritzTranscript } from '../../../../client/src/dailyFritz/dailyFritzTranscript.ts';
import type { MoveEntry } from '../../../../client/src/game/moveLogger.ts';

// ROOT CAUSE (see dailyFritzHandService.ts:sealBlockedHand / dailyFritzTranscript.ts):
//
// When a scoring play or double keeps the turn ("extra turn") and the
// boneyard has drawable tiles, packages/game-core/src/engine.ts's applyMove
// resolves the *entire* forced-draw chain inside that single 'play' command.
// If the chain drains the boneyard to empty and the actor still has no legal
// play, applyMove recurses into an embedded, unlogged `{type:'pass'}` for
// that SAME actor — flipping the turn to the opponent and incrementing
// consecutivePasses, all inside the one 'play' transcript action. No
// separate MoveEntry is ever produced for this embedded pass (by design —
// see the comment at engine.ts around line 645, "Daily Fritz transcripts do
// not need separate draw actions for post-score recovery draws").
//
// client/src/dailyFritz/dailyFritzTranscript.ts's missingBlockedHandPassActors
// does not know about this embedded pass. It assumes "extra turn" (scored
// play or double) always means "same actor keeps the turn, consecutivePasses
// resets to 0" — true only when the boneyard was ALREADY empty before the
// play. When the forced-draw chain itself empties the boneyard, the real
// engine has already silently banked one pass and flipped the turn, but the
// heuristic doesn't know that, undercounts consecutivePasses by 1, and
// appends one bogus extra synthetic pass action once the local hand is
// observed to have ended blocked with both sides holding tiles.
//
// If that embedded pass was itself the SECOND consecutive pass (block
// resolves entirely inside the preceding 'play' transcript action), the
// transcript is already fully terminal after that one action. The extra
// synthetic pass the client appends is then a logged action *after*
// handOver — which server/src/dailyFritzVerifier.ts rejects with
// 'post_terminal_action', a verifier error code that is NOT in
// dailyFritzNextHandFailurePolicy.ts's REBUILD_CODES list. The client falls
// straight to the stuck "Couldn't verify this hand yet" banner with no
// automatic recovery.
//
// This is why the incident correlates with two-sided blocks specifically:
// a two-sided block requires the boneyard to run out near the end of the
// hand while both players are still stuck holding tiles — exactly the
// condition that triggers the embedded forced-draw-chain auto-pass this
// heuristic mishandles. A clean go-out never reaches this code path at all
// (sealBlockedHand is gated on match.handOver && both hands nonempty).

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

// Player opens with the double 4|4 (always a legal opener regardless of
// scoring multiple). Player's other tile {1,2} cannot follow a 4-end.
// The boneyard has two tiles that also cannot follow a 4-end: the entire
// forced-draw chain triggered by the double drains the boneyard to empty
// without ever producing a playable tile for the player, so
// packages/game-core/src/engine.ts embeds a silent internal pass for the
// player (flips the turn to Fritz, consecutivePasses: 0 -> 1) *inside* that
// one 'play' command. Fritz's only tile {6,6} also cannot follow a 4-end and
// the boneyard is already empty, so Fritz's only legal move is an explicit
// pass, which brings consecutivePasses to 2 and blocks the hand — entirely
// via TWO transcript actions (the double play, then Fritz's pass), with
// nothing else needed. Both sides end holding tiles: a genuine two-sided
// block.
const TWO_SIDED_BLOCK_DEAL = {
  player_tiles: [{ low: 4, high: 4 }, { low: 1, high: 2 }],
  fritz_tiles: [{ low: 6, high: 6 }],
  boneyard: [{ low: 1, high: 3 }, { low: 2, high: 6 }],
  locked: [],
};

function buildRun(overrides: Partial<DailyFritzRunRecord> = {}): DailyFritzRunRecord {
  return {
    runDate: RUN_DATE,
    seed: getDailyFritzSeed(RUN_DATE),
    fritzTier: 'standard',
    dealSize: 7,
    winningScore: 500, // high enough that this single block hand does not end the game
    status: 'live',
    handDeals: [TWO_SIDED_BLOCK_DEAL],
    generatedAt: '2026-08-10T00:00:00.000Z',
    invalidatedAt: null,
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
    ...overrides,
  };
}

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
  return { current: () => stored };
}

/**
 * Builds the moveLog exactly as the real client's game loop would: ONE
 * MoveEntry per top-level command actually issued (play, draw, pass). The
 * embedded auto-pass inside applyMove's forced-draw chain (see engine.ts) is
 * NEVER separately logged by production code — that is the documented,
 * intentional contract (engine.ts: "Daily Fritz transcripts do not need
 * separate draw actions for post-score recovery draws"). This is exactly
 * what a real player's session would produce for TWO_SIDED_BLOCK_DEAL.
 */
function buildRealClientMoveLog(): MoveEntry[] {
  return [
    {
      moveNumber: 0,
      handNumber: 1,
      player: 'you',
      action: 'place',
      tile: [4, 4],
      position: 'left',
      boardEnds: [4, 4],
      handBefore: [[4, 4], [1, 2]],
      validMoves: [[4, 4]],
      pipDelta: -8,
      pointsScored: 0,
      boardState: [],
      boardRenderState: null,
    } as unknown as MoveEntry,
    {
      moveNumber: 1,
      handNumber: 1,
      player: 'opponent',
      action: 'pass',
      boardEnds: [4, 4],
      handBefore: [[6, 6]],
      validMoves: [],
      pipDelta: 0,
      pointsScored: 0,
      boardState: [],
      boardRenderState: null,
    } as unknown as MoveEntry,
  ];
}

describe('Daily Fritz: real client transcript builder on a two-sided block, through the real HTTP verification path', () => {
  afterEach(() => {
    authUserMock.mockReset();
    getAttemptByIdMock.mockReset();
    getAttemptMock.mockReset();
    upsertAttemptMock.mockReset();
    getRunMock.mockReset();
  });

  it('accepts a two-sided-block transcript built by the real client buildDailyFritzTranscript (sealBlockedHand path)', async () => {
    authUserMock.mockResolvedValue(USER_ID);
    const run = buildRun();
    const store = wireStore(buildAttempt(), run);

    // This mirrors exactly what client/src/modules/match/hand-lifecycle/dailyFritzHandService.ts
    // does in buildDailyFritzPrefetchParams: sealBlockedHand is set purely from
    // match.handOver && both hands nonempty && boneyard depleted — true here.
    const transcript = buildDailyFritzTranscript({
      challengeId: buildDailyFritzChallengeId(RUN_DATE),
      attemptId: ATTEMPT_ID,
      gameNumber: 1,
      handIndex: 0,
      handNumber: 1,
      moveLog: buildRealClientMoveLog(),
      attemptPredatesJournalRollout: true,
      protocolVersion: 2,
      clientRelease: 'test-client',
      // This is the authoritative post-hand engine state a real client would
      // have (BotMatchState.consecutivePasses / currentPlayer): the block
      // already fully resolved via the embedded auto-pass (player) + the
      // explicit fritz pass, so consecutivePasses is already 2 and no
      // further sealing is needed. This is the FIXED call shape — see
      // client/src/modules/match/hand-lifecycle/dailyFritzHandService.ts.
      sealBlockedHand: { consecutivePasses: 2, nextActor: 'player' },
    });

    // Sanity: the (fixed) seal logic appends nothing extra, because the real
    // engine state says the block already fully resolved inside the two
    // logged actions above.
    expect(transcript.actions).toHaveLength(2);

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

    // BEFORE THE FIX: this is 400 with verifierCode 'post_terminal_action' —
    // exactly the stuck-banner symptom (not in REBUILD_CODES, so the client
    // exhausts no retries and lands straight on "Couldn't verify this hand
    // yet"). AFTER THE FIX: this must succeed (200, hand advances) — a
    // legitimate two-sided block must verify.
    if (nextHandResponse.status >= 400) {
      // Surface the exact rejection for diagnosis if this regresses.
      throw new Error(
        `Real two-sided block was rejected by the real HTTP path: status=${nextHandResponse.status} `
        + `code=${nextHandResponse.body?.code} error=${nextHandResponse.body?.error}`,
      );
    }
    expect(nextHandResponse.status).toBe(200);
    void store;
  });

  it('accepts the same two-sided block as the FINAL (game-ending) hand of the game', async () => {
    authUserMock.mockResolvedValue(USER_ID);
    // Low winning score: the block's pip-differential bonus alone ends the game.
    const run = buildRun({ winningScore: 1 });
    wireStore(buildAttempt(), run);

    const transcript = buildDailyFritzTranscript({
      challengeId: buildDailyFritzChallengeId(RUN_DATE),
      attemptId: ATTEMPT_ID,
      gameNumber: 1,
      handIndex: 0,
      handNumber: 1,
      moveLog: buildRealClientMoveLog(),
      attemptPredatesJournalRollout: true,
      protocolVersion: 2,
      clientRelease: 'test-client',
      sealBlockedHand: { consecutivePasses: 2, nextActor: 'player' },
    });
    expect(transcript.actions).toHaveLength(2);

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
    // Game-ending hands 409 from /next-hand (client must call /record-game),
    // but the verifier itself must have ACCEPTED the transcript to get here
    // rather than 400ing on the (fixed) transcript.
    expect(nextHandResponse.status).toBe(409);
    expect(nextHandResponse.body?.code).not.toBe('post_terminal_action');

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
    expect(recordGameResponse.body.set_result.games[0].handsPlayed).toBe(1);
  });

  it('accepts a lopsided two-sided block (winner down to 1 tile, loser holding several)', async () => {
    authUserMock.mockResolvedValue(USER_ID);
    // Player opens with the double 2|2 (extra turn). Player's other two
    // tiles {0,3},{5,6} cannot follow a 2-end. The boneyard has three tiles
    // that also cannot follow a 2-end, so the forced-draw chain drains the
    // boneyard to empty without ever producing a play — embedded auto-pass,
    // same mechanism as TWO_SIDED_BLOCK_DEAL but with a lopsided final tile
    // count (player ends holding 5 tiles, Fritz holds 1).
    const lopsidedDeal = {
      player_tiles: [{ low: 2, high: 2 }, { low: 0, high: 3 }, { low: 5, high: 6 }],
      fritz_tiles: [{ low: 4, high: 5 }],
      boneyard: [{ low: 0, high: 1 }, { low: 3, high: 6 }, { low: 1, high: 5 }],
      locked: [],
    };
    const run = buildRun({ handDeals: [lopsidedDeal] });
    wireStore(buildAttempt(), run);

    const moveLog: MoveEntry[] = [
      {
        moveNumber: 0,
        handNumber: 1,
        player: 'you',
        action: 'place',
        tile: [2, 2],
        position: 'left',
        boardEnds: [2, 2],
        handBefore: [[2, 2], [0, 3], [5, 6]],
        validMoves: [[2, 2]],
        pipDelta: -4,
        pointsScored: 0,
        boardState: [],
        boardRenderState: null,
      } as unknown as MoveEntry,
      {
        moveNumber: 1,
        handNumber: 1,
        player: 'opponent',
        action: 'pass',
        boardEnds: [2, 2],
        handBefore: [[4, 5]],
        validMoves: [],
        pipDelta: 0,
        pointsScored: 0,
        boardState: [],
        boardRenderState: null,
      } as unknown as MoveEntry,
    ];

    const transcript = buildDailyFritzTranscript({
      challengeId: buildDailyFritzChallengeId(RUN_DATE),
      attemptId: ATTEMPT_ID,
      gameNumber: 1,
      handIndex: 0,
      handNumber: 1,
      moveLog,
      attemptPredatesJournalRollout: true,
      protocolVersion: 2,
      clientRelease: 'test-client',
      sealBlockedHand: { consecutivePasses: 2, nextActor: 'player' },
    });
    expect(transcript.actions).toHaveLength(2);

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
    if (nextHandResponse.status >= 400) {
      throw new Error(
        `Lopsided two-sided block was rejected: status=${nextHandResponse.status} `
        + `code=${nextHandResponse.body?.code} error=${nextHandResponse.body?.error}`,
      );
    }
    expect(nextHandResponse.status).toBe(200);
  });
});

describe('Daily Fritz: a two-sided block that hit the pre-fix bug does not permanently lock the player out (Step 7)', () => {
  const previousFixturesFlag = process.env.DAILY_FRITZ_TEST_FIXTURES_ENABLED;

  beforeEach(() => {
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

  function freshClientStartRequestBody() {
    return {
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

  it('a stuck post_terminal_action rejection leaves server state intact, and a fresh client (simulated reload) can still resume and eventually verify the hand', async () => {
    authUserMock.mockResolvedValue(USER_ID);
    const run = buildRun();
    const store = wireStore(buildAttempt(), run);
    const request = makeHarness();

    // 1. Reproduce the PRE-FIX bug directly: build a transcript the way the
    // OLD (buggy) client code did — sealing with a stale/undercounted
    // consecutivePasses of 1 (as the old move-log-only heuristic would have
    // computed for this exact deal, since it can't see that the embedded
    // auto-pass inside the double play already banked one pass and handed
    // the turn to fritz). This appends one bogus extra 'player:pass' after
    // the hand's true terminal state.
    const buggyTranscript = buildDailyFritzTranscript({
      challengeId: buildDailyFritzChallengeId(RUN_DATE),
      attemptId: ATTEMPT_ID,
      gameNumber: 1,
      handIndex: 0,
      handNumber: 1,
      moveLog: buildRealClientMoveLog(),
      attemptPredatesJournalRollout: true,
      protocolVersion: 2,
      clientRelease: 'test-client',
      sealBlockedHand: { consecutivePasses: 1, nextActor: 'player' }, // the old, wrong count
    });
    expect(buggyTranscript.actions).toHaveLength(3); // bogus extra action appended

    const stuckResponse = await request('POST', '/api/daily-fritz/next-hand', {
      body: {
        attempt_id: ATTEMPT_ID,
        verified_match_id: VERIFIED_MATCH_ID,
        run_date: RUN_DATE,
        game_number: 1,
        completed_hand_index: 0,
        transcript: buggyTranscript,
      },
    });
    expect(stuckResponse.status).toBe(400);
    expect(stuckResponse.body?.code).toBe('post_terminal_action');

    // 2. Server state must be untouched by the rejected attempt — no
    // corruption, no partial write, hand index still at 0.
    const afterStuck = store.current();
    expect(afterStuck.currentHandIndex).toBe(0);
    expect(afterStuck.status).toBe('started');
    const handsAfterStuck = (afterStuck.result as any)?.authority?.hands ?? [];
    expect(handsAfterStuck).toHaveLength(0);

    // 3. Simulate the player closing and reopening the client entirely: a
    // brand-new request with zero in-memory state, resuming via /start (the
    // real resume entrypoint — see dailyFritzHandOverPersistence.test.ts).
    const resumeResponse = await request('POST', '/api/daily-fritz/start', {
      body: freshClientStartRequestBody(),
    });
    expect(resumeResponse.status).toBe(200);
    // The player is NOT locked out: resume reports the same in-progress hand
    // (index 0), not an error, not a wiped attempt, not stuck forever.
    expect(resumeResponse.body.current_hand_index).toBe(0);
    expect(resumeResponse.body.attempt_status).not.toBe('abandoned');

    // 4. The (now-fixed) client re-derives the transcript for the SAME hand
    // and resubmits — this must succeed, proving recovery is possible, not
    // just "no corruption occurred".
    const fixedTranscript = buildDailyFritzTranscript({
      challengeId: buildDailyFritzChallengeId(RUN_DATE),
      attemptId: ATTEMPT_ID,
      gameNumber: 1,
      handIndex: 0,
      handNumber: 1,
      moveLog: buildRealClientMoveLog(),
      attemptPredatesJournalRollout: true,
      protocolVersion: 2,
      clientRelease: 'test-client',
      sealBlockedHand: { consecutivePasses: 2, nextActor: 'player' }, // the correct, authoritative count
    });
    const recoveredResponse = await request('POST', '/api/daily-fritz/next-hand', {
      body: {
        attempt_id: ATTEMPT_ID,
        verified_match_id: VERIFIED_MATCH_ID,
        run_date: RUN_DATE,
        game_number: 1,
        completed_hand_index: 0,
        transcript: fixedTranscript,
      },
    });
    expect(recoveredResponse.status).toBe(200);
    expect(recoveredResponse.body.current_hand_index).toBe(1);
    expect(store.current().currentHandIndex).toBe(1);
  });
});
