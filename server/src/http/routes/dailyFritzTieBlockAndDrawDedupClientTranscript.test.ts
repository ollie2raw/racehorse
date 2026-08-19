import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Application } from 'express';
import { buildDailyFritzChallengeId } from '../../dailyFritzIdentity';
import { getDailyFritzSeed } from '../../dailyFritz';
import type { DailyFritzAttemptRecord, DailyFritzRunRecord } from '../stores/dailyFritzStore';
import { buildDailyFritzTranscript } from '../../../../client/src/dailyFritz/dailyFritzTranscript.ts';
import { canonicalizeDailyFritzMoveLog } from '../../../../client/src/dailyFritz/dailyFritzMoveEvidence.ts';
import type { MoveEntry } from '../../../../client/src/game/moveLogger.ts';
import {
  createFixedBotMatchWithStarter,
  applyPlayMove,
  drawOne,
  passTurn,
  getLegalMoves,
} from '../../../../client/src/modules/match/runtime/botEngine.ts';
import { isDailyFritzLockedBoneyardNoMove } from '../../../../client/src/modules/player-turn/dailyFritzBlockedHand.ts';
import { collectPlayerMoveSnapshot } from '../../../../client/src/modules/player-turn/playerMoveSnapshot.ts';
import {
  buildDrawMoveLogEntry,
  buildPassMoveLogEntry,
  buildPlacementMoveLogEntry,
} from '../../../../client/src/modules/player-turn/playerMoveLogEntries.ts';
import { asPlayMoves } from '../../../../client/src/game/tileUtils.ts';

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

// Bot opens with a double, keeps the extra turn (a legal follow-up play
// exists so it never enters the embedded forced-draw chain), then passes
// the turn to the player normally. This isolates the case under test: the
// player's SEPARATE, real turn-based forced-draw sequence
// (usePlayerNoMoveEffect.ts), not the already-fixed embedded-play chain.
const TIE_DEAL = {
  player_tiles: [{ low: 0, high: 0 }],
  fritz_tiles: [{ low: 5, high: 5 }, { low: 5, high: 6 }, { low: 3, high: 4 }],
  boneyard: [{ low: 1, high: 2 }, { low: 1, high: 3 }],
  locked: [],
};

function buildRun(overrides: Partial<DailyFritzRunRecord> = {}): DailyFritzRunRecord {
  return {
    runDate: RUN_DATE,
    seed: getDailyFritzSeed(RUN_DATE),
    fritzTier: 'standard',
    dealSize: 7,
    winningScore: 500,
    status: 'live',
    handDeals: [TIE_DEAL],
    generatedAt: '2026-08-10T00:00:00.000Z',
    invalidatedAt: null,
    metadata: { draw_winners_by_game: { '1': 'bot' } },
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
 * Drives TIE_DEAL through the REAL client engine (botEngine.ts /
 * applyPlayMove / drawOne / passTurn — the same functions the React hooks
 * call) to a genuine blocked TIE ending (both sides 7 pips), producing a
 * real, honest MoveEntry log.
 *
 * `injectDrawDedupBug`: when true, mimics exactly what
 * usePlayerNoMoveEffect.ts's `drawSnapshots[index] ?? snapshot` fallback
 * produces when the onStep-collected drawSnapshots array undercounts
 * relative to the boneyard-delta-corrected drawCount (the code's own
 * comment: "onStep can undercount if interrupted") — the second draw's
 * MoveEntry is built from the SAME stale top-of-effect snapshot as the
 * first, instead of its own real per-step snapshot. This is the real
 * `buildDrawMoveLogEntry` production function, just fed the snapshot the
 * way the buggy fallback path feeds it.
 */
function driveTieDealMoveLog(injectDrawDedupBug: boolean): MoveEntry[] {
  const moveLog: MoveEntry[] = [];
  let match = createFixedBotMatchWithStarter(TIE_DEAL, 'bot', 500, 7);
  let moveNumber = 0;

  // Bot opens with the double 5|5.
  {
    const before = match;
    const result = applyPlayMove(before, 'bot', { type: 'play', tile: { low: 5, high: 5 }, position: 'left' });
    if (result.error) throw new Error(`setup: bot open failed: ${result.error.message}`);
    match = result.state;
    moveLog.push({
      moveNumber: moveNumber++,
      handNumber: match.handNumber,
      player: 'opponent',
      action: 'place',
      tile: [5, 5],
      position: 'left',
      boardEnds: [5, 5],
      handBefore: [],
      validMoves: [],
      pipDelta: 0,
      pointsScored: 0,
      boardState: [],
      boardRenderState: null,
    } as unknown as MoveEntry);
  }

  // Bot keeps the extra turn (double) and plays 5|6, ending its turn normally.
  {
    const before = match;
    const legal = asPlayMoves(getLegalMoves(before, 'bot'));
    const move = legal.find((m) => m.tile && m.tile.low === 5 && m.tile.high === 6)
      ?? legal.find((m) => m.tile && m.tile.low === 6 && m.tile.high === 5);
    if (!move) throw new Error('setup: bot follow-up play not found');
    const result = applyPlayMove(before, 'bot', move);
    if (result.error) throw new Error(`setup: bot follow-up failed: ${result.error.message}`);
    match = result.state;
    moveLog.push({
      moveNumber: moveNumber++,
      handNumber: match.handNumber,
      player: 'opponent',
      action: 'place',
      tile: [5, 6],
      position: move.position,
      boardEnds: [5, 5],
      handBefore: [],
      validMoves: [],
      pipDelta: 0,
      pointsScored: 0,
      boardState: [],
      boardRenderState: null,
    } as unknown as MoveEntry);
  }

  if (match.currentPlayer !== 'you') {
    throw new Error(`setup: expected player's turn, got ${match.currentPlayer}`);
  }
  if (asPlayMoves(getLegalMoves(match, 'you')).length !== 0) {
    throw new Error('setup: expected player to have zero legal plays');
  }
  if (isDailyFritzLockedBoneyardNoMove(match)) {
    throw new Error('setup: expected the boneyard to NOT look mutually locked yet (real draws needed)');
  }

  // Player's real forced-draw sequence: usePlayerNoMoveEffect.ts's else
  // branch. Captures the stale top-of-effect snapshot exactly like the real
  // hook does before any draws happen.
  const staleTopSnapshot = collectPlayerMoveSnapshot(match, []);
  const matchBeforeDraws = match;
  let drawIndex = 0;
  while (asPlayMoves(getLegalMoves(match, 'you')).length === 0) {
    const beforeDraw = match;
    const step = drawOne(beforeDraw, 'you');
    if (!step.drew) break;
    match = step.state;
    const realPerStepSnapshot = collectPlayerMoveSnapshot(beforeDraw, []);
    const snapshotForThisDraw = injectDrawDedupBug && drawIndex >= 1
      ? staleTopSnapshot
      : realPerStepSnapshot;
    moveLog.push({
      moveNumber: moveNumber++,
      handNumber: match.handNumber,
      ...buildDrawMoveLogEntry(matchBeforeDraws, snapshotForThisDraw, 'medium'),
    } as unknown as MoveEntry);
    drawIndex += 1;
  }
  if (asPlayMoves(getLegalMoves(match, 'you')).length !== 0) {
    throw new Error('setup: expected player to still have zero legal plays after draining the boneyard');
  }

  // Player's pass (first pass of the hand).
  {
    const before = match;
    const snapshot = collectPlayerMoveSnapshot(before, []);
    const result = passTurn(before, 'you');
    if (result.error) throw new Error(`setup: player pass failed: ${result.error.message}`);
    match = result.state;
    moveLog.push({
      moveNumber: moveNumber++,
      handNumber: match.handNumber,
      ...buildPassMoveLogEntry(before, snapshot, 'medium'),
    } as unknown as MoveEntry);
  }

  if (match.handOver) {
    throw new Error('setup: expected only one pass so far — hand should not be over yet');
  }
  if (match.currentPlayer !== 'bot') {
    throw new Error(`setup: expected bot's turn after player's pass, got ${match.currentPlayer}`);
  }
  if (asPlayMoves(getLegalMoves(match, 'bot')).length !== 0) {
    throw new Error('setup: expected bot to have zero legal plays too (mutual block)');
  }

  // Bot's pass — second consecutive pass, resolves the block.
  {
    const before = match;
    const result = passTurn(before, 'bot');
    if (result.error) throw new Error(`setup: bot pass failed: ${result.error.message}`);
    match = result.state;
    moveLog.push({
      moveNumber: moveNumber++,
      handNumber: match.handNumber,
      player: 'opponent',
      action: 'pass',
      boardEnds: [5, 6],
      handBefore: [],
      validMoves: [],
      pipDelta: 0,
      pointsScored: 0,
      boardState: [],
      boardRenderState: null,
    } as unknown as MoveEntry);
  }

  if (!match.handOver) {
    throw new Error('setup: expected the hand to be over (two-sided block) after both passes');
  }
  if (match.winnerId !== null) {
    throw new Error(`setup: expected a TIE (winnerId null), got ${match.winnerId}`);
  }

  return moveLog;
}

describe('Daily Fritz: player multi-draw dedup collapse on a real blocked TIE ending', () => {
  afterEach(() => {
    authUserMock.mockReset();
    getAttemptByIdMock.mockReset();
    getAttemptMock.mockReset();
    upsertAttemptMock.mockReset();
    getRunMock.mockReset();
  });

  it('sanity: the deal really produces a mutual block with equal (tied) pip counts', () => {
    const honestLog = driveTieDealMoveLog(false);
    const drawActions = honestLog.filter((e) => e.player === 'you' && e.action === 'draw');
    expect(drawActions).toHaveLength(2);
  });

  it('unit: canonicalizeDailyFritzMoveLog silently drops the second real draw when its logged evidence is (buggily) identical to the first', () => {
    const buggyLog = driveTieDealMoveLog(true);
    const playerDraws = buggyLog.filter((e) => e.player === 'you' && e.action === 'draw');
    expect(playerDraws).toHaveLength(2); // both really happened and were logged...

    const canonical = canonicalizeDailyFritzMoveLog(buggyLog);
    const canonicalPlayerDraws = canonical.filter((e) => e.player === 'you' && e.action === 'draw');
    // ...but the defense-in-depth dedup collapses them to one, because it
    // cannot tell a genuine second draw (that happens to reuse a stale
    // snapshot) from an accidental duplicate submission.
    expect(canonicalPlayerDraws).toHaveLength(1);
  });

  it('an honest (non-buggy) transcript for the real TIE block verifies successfully through the real HTTP path', async () => {
    authUserMock.mockResolvedValue(USER_ID);
    const run = buildRun();
    wireStore(buildAttempt(), run);

    const honestLog = driveTieDealMoveLog(false);
    const transcript = buildDailyFritzTranscript({
      challengeId: buildDailyFritzChallengeId(RUN_DATE),
      attemptId: ATTEMPT_ID,
      gameNumber: 1,
      handIndex: 0,
      handNumber: 1,
      moveLog: honestLog,
      attemptPredatesJournalRollout: true,
      protocolVersion: 2,
      clientRelease: 'test-client',
      sealBlockedHand: { consecutivePasses: 2, nextActor: 'fritz' },
    });

    const request = makeHarness();
    const response = await request('POST', '/api/daily-fritz/next-hand', {
      body: {
        attempt_id: ATTEMPT_ID,
        verified_match_id: VERIFIED_MATCH_ID,
        run_date: RUN_DATE,
        game_number: 1,
        completed_hand_index: 0,
        transcript,
      },
    });
    if (response.status >= 400) {
      throw new Error(
        `Honest TIE-block transcript was rejected: status=${response.status} `
        + `code=${response.body?.code} error=${response.body?.error}`,
      );
    }
    expect(response.status).toBe(200);
  });

  // ROOT CAUSE (see client/src/modules/player-turn/usePlayerNoMoveEffect.ts and
  // client/src/modules/daily/dailyFritzDrawTranscript.ts's capDailyFritzDrawLogCount):
  //
  // usePlayerNoMoveEffect.ts's real forced-draw sequence corrects its draw
  // count UPWARD from a boneyard-length delta ("onStep can undercount if
  // interrupted"), then iterates that (possibly inflated) count to build
  // 'draw' MoveEntries, falling back to the STALE pre-draw snapshot for any
  // index beyond the real per-step drawSnapshots it collected. If that
  // upward correction ever exceeds the real onStep-confirmed draw count
  // (e.g. an interrupted/overlapping local run), it fabricates one or more
  // 'draw' MoveEntries with no corresponding real drawOne() call behind
  // them. dailyFritzMoveEvidence.ts's evidence-based dedup
  // (isDuplicateDailyFritzActionEvidence / canonicalizeDailyFritzMoveLog) is
  // supposed to catch accidental duplicate submissions, but it only compares
  // JSON-serialized handBefore/boardEnds/boardState — a fabricated entry
  // whose evidence happens to differ even slightly from its neighbor (as a
  // real interleaved capture would) sails straight through undetected.
  //
  // Once that extra 'draw' action reaches the server, it is fatal: unlike a
  // MISSING draw (which server/src/dailyFritzVerifier.ts's
  // applyOmittedMandatoryDraws silently reconstructs before any later
  // action), there is no recovery for an EXTRA one — it is replayed as a
  // real draw command and rejected the instant canDraw is false, producing
  // exactly 'illegal_action' / "Draw is not legal" — the stuck "Couldn't
  // verify this hand yet" banner from the incident report. This test
  // reproduces that exact failure signature end-to-end through the real
  // HTTP path. The fix (capDailyFritzDrawLogCount) caps the logged draw
  // count at the number of real per-step snapshots observed, so this
  // fabrication can no longer happen from usePlayerNoMoveEffect.ts /
  // completeBotTurnAction — this test pins the server-side failure mode
  // itself as a permanent regression guard, independent of which client
  // code path a future bug might use to (re-)introduce a spurious draw.
  it('REPRODUCTION: a spurious extra draw MoveEntry (not caught by evidence dedup) reproduces the exact "Draw is not legal" stuck-Hand-Over failure', async () => {
    authUserMock.mockResolvedValue(USER_ID);
    const run = buildRun();
    wireStore(buildAttempt(), run);

    const honestLog = driveTieDealMoveLog(false);
    // Splice in one extra 'draw' MoveEntry for the player right after the two
    // real draws (before the pass), with evidence that differs just enough
    // (a distinct boardStateKey/handSnapshot marker) to slip past the
    // evidence-based dedup guard — modeling a genuine accidental duplicate
    // draw submission that the defense-in-depth dedup fails to catch,
    // because it is snapshot-pattern-matching rather than authoritative.
    const drawIdx = honestLog.findIndex((e) => e.player === 'you' && e.action === 'draw');
    const secondDraw = honestLog[drawIdx + 1];
    const spuriousExtraDraw = {
      ...secondDraw,
      moveNumber: secondDraw.moveNumber + 0.5,
      handBefore: [...(secondDraw as any).handBefore, [9, 9]], // forces different JSON evidence
    };
    const withExtraDraw = [
      ...honestLog.slice(0, drawIdx + 2),
      spuriousExtraDraw,
      ...honestLog.slice(drawIdx + 2),
    ] as MoveEntry[];

    const transcript = buildDailyFritzTranscript({
      challengeId: buildDailyFritzChallengeId(RUN_DATE),
      attemptId: ATTEMPT_ID,
      gameNumber: 1,
      handIndex: 0,
      handNumber: 1,
      moveLog: withExtraDraw,
      attemptPredatesJournalRollout: true,
      protocolVersion: 2,
      clientRelease: 'test-client',
      sealBlockedHand: { consecutivePasses: 2, nextActor: 'fritz' },
    });
    const playerDrawActions = transcript.actions.filter((a) => a.actor === 'player' && a.kind === 'draw');
    // The spurious draw survived canonicalization (evaded the evidence dedup).
    expect(playerDrawActions).toHaveLength(3);

    const request = makeHarness();
    const response = await request('POST', '/api/daily-fritz/next-hand', {
      body: {
        attempt_id: ATTEMPT_ID,
        verified_match_id: VERIFIED_MATCH_ID,
        run_date: RUN_DATE,
        game_number: 1,
        completed_hand_index: 0,
        transcript,
      },
    });
    expect(response.status).toBe(400);
    expect(response.body?.code).toBe('illegal_action');
    expect(response.body?.error).toMatch(/draw/i);
  });

  it('a MISSING draw MoveEntry (dedup-collapsed second draw) self-heals via the server\'s applyOmittedMandatoryDraws recovery', async () => {
    authUserMock.mockResolvedValue(USER_ID);
    const run = buildRun();
    wireStore(buildAttempt(), run);

    const buggyLog = driveTieDealMoveLog(true);
    const transcript = buildDailyFritzTranscript({
      challengeId: buildDailyFritzChallengeId(RUN_DATE),
      attemptId: ATTEMPT_ID,
      gameNumber: 1,
      handIndex: 0,
      handNumber: 1,
      moveLog: buggyLog,
      attemptPredatesJournalRollout: true,
      protocolVersion: 2,
      clientRelease: 'test-client',
      sealBlockedHand: { consecutivePasses: 2, nextActor: 'fritz' },
    });
    // Confirm the collapse actually happened in the real transcript we're about to submit.
    const playerDrawActions = transcript.actions.filter((a) => a.actor === 'player' && a.kind === 'draw');
    expect(playerDrawActions).toHaveLength(1);

    const request = makeHarness();
    const response = await request('POST', '/api/daily-fritz/next-hand', {
      body: {
        attempt_id: ATTEMPT_ID,
        verified_match_id: VERIFIED_MATCH_ID,
        run_date: RUN_DATE,
        game_number: 1,
        completed_hand_index: 0,
        transcript,
      },
    });

    // A missing draw is safely self-healed server-side (unlike the extra-draw
    // case above), so this transcript still verifies successfully.
    if (response.status >= 400) {
      throw new Error(
        `Missing-draw transcript unexpectedly failed to self-heal: status=${response.status} `
        + `code=${response.body?.code} error=${response.body?.error}`,
      );
    }
    expect(response.status).toBe(200);
  });
});
