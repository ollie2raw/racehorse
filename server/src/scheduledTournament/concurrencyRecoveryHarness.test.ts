/**
 * Step 5 / PR-F — concurrency + recovery harness (HARDENING_PLAN.md §1.6).
 *
 * IMPORTANT SCOPE BOUNDARY: everything in this file runs against the
 * in-memory RPC port (`inMemoryMatchRpc.testkit.ts`), which is synchronous
 * end-to-end — Node's single-threaded event loop serializes it for free. That
 * proves the **Node orchestration** (`applyMatchResult` calling the RPC once
 * per producer, acting on `{applied, conflict}`) handles a redundant producer
 * correctly. It does NOT and CANNOT prove that the real Postgres
 * `SELECT ... FOR UPDATE` actually serializes two concurrent transactions —
 * that is a claim about the database, not about this test suite, and is
 * verified separately by PR-G's local two-session pg16 script (the one that
 * was run once during PR-A and thrown away). Do not read a green run of this
 * file as DB-level proof.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const capturedLogs: Array<{ context?: string; msg?: string; [k: string]: unknown }> = [];

vi.mock('../logger', () => ({
  childLogger: (context: string) => ({
    info: (obj: unknown, msg: string) => {
      capturedLogs.push({ context, msg, ...(typeof obj === 'object' && obj ? obj : {}) });
    },
    debug: (obj: unknown, msg: string) => {
      capturedLogs.push({ context, msg, ...(typeof obj === 'object' && obj ? obj : {}) });
    },
    warn: (obj: unknown, msg: string) => {
      capturedLogs.push({ context, msg, ...(typeof obj === 'object' && obj ? obj : {}) });
    },
    error: (obj: unknown, msg: string) => {
      capturedLogs.push({ context, msg, ...(typeof obj === 'object' && obj ? obj : {}) });
    },
  }),
  logger: { child: () => ({}) },
}));

vi.mock('../social/activityWriter', () => ({
  writeTournamentActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./matchDispatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./matchDispatch')>();
  return {
    ...actual,
    dispatchTournamentMatch: vi.fn(async (_io, matchId: string, _opts, persistence) => {
      const match = await persistence.fetchMatchById(matchId);
      if (match) {
        await persistence.updateMatch(matchId, {
          room_code: match.room_code || `R-${matchId}`,
          status: match.status === 'in_progress' ? 'in_progress' : 'ready',
          ready_at: match.ready_at ?? new Date('2026-05-16T00:00:00Z').toISOString(),
          ready_deadline_at: match.ready_deadline_at ?? new Date('2026-05-16T00:02:00Z').toISOString(),
        });
      }
      return {
        ok: true,
        matchId,
        tournamentId: match?.tournament_id ?? 'tour-1',
        roomCode: match?.room_code || `R-${matchId}`,
        status: match?.status === 'in_progress' ? 'in_progress' : 'ready',
        readyAt: match?.ready_at ?? new Date('2026-05-16T00:00:00Z').toISOString(),
        readyDeadlineAt: match?.ready_deadline_at ?? new Date('2026-05-16T00:02:00Z').toISOString(),
        recipients: [],
        reusedExistingRoom: Boolean(match?.room_code),
        emittedReady: true,
      };
    }),
  };
});

import {
  generateBracket,
  applyMatchResult,
  reconcileExpiredReadyMatches,
  dispatchScheduledStartMatches,
} from './engine';
import { recoverTournamentMatches } from './recovery';
import type { EnginePersistence } from './persistenceInterface';
import { inMemoryMatchRpcForArrayStore, recordMatchResultForTest } from './inMemoryMatchRpc.testkit';
import { assertBracketConsistentForStore, collectBracketConsistencyViolations } from './assertBracketConsistent.testkit';
import type { MatchRow, RegistrationRow, ScheduledTournamentRow } from './types';

// ── shared fixture builders (mirrors engine.test.ts — kept local per this
// repo's convention of each test file owning its own builders) ─────────────

function makeIoMock() {
  const events: Array<{ target: string; event: string; payload: unknown }> = [];
  const sockets = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8'].map((userId) => ({
    id: `sock-${userId}`,
    data: { userId },
    emit: (event: string, payload: unknown) => {
      events.push({ target: userId, event, payload });
    },
  }));
  const io = {
    emit: (event: string, payload: unknown) => {
      events.push({ target: 'global', event, payload });
    },
    sockets: { sockets: new Map(sockets.map((s) => [s.id, s])) },
  } as unknown as import('socket.io').Server;
  return { io, events };
}

function makeTournament(overrides: Partial<ScheduledTournamentRow> = {}): ScheduledTournamentRow {
  return {
    id: 'tour-1',
    scheduled_start: new Date('2026-05-15T00:00:00Z').toISOString(),
    registration_open_at: new Date('2026-05-14T23:30:00Z').toISOString(),
    registration_close_at: new Date('2026-05-14T23:58:00Z').toISOString(),
    status: 'in_progress',
    format: '7-tile',
    win_target: 30,
    max_players: 8,
    winner_id: null,
    created_at: new Date('2026-05-01T00:00:00Z').toISOString(),
    ...overrides,
  };
}

function makeReg(userId: string, overrides: Partial<RegistrationRow> = {}): RegistrationRow {
  return {
    id: `reg-${userId}`,
    tournament_id: 'tour-1',
    user_id: userId,
    registered_at: new Date('2026-05-14T23:00:00Z').toISOString(),
    seed: null,
    placement: null,
    status: 'registered',
    ...overrides,
  };
}

function makePersistence(
  tournament: ScheduledTournamentRow,
  initialRegs: RegistrationRow[],
  initialMatches: MatchRow[] = [],
): { persistence: EnginePersistence; store: { matches: MatchRow[]; regs: RegistrationRow[]; tournament: ScheduledTournamentRow } } {
  const store = {
    tournament: { ...tournament },
    regs: initialRegs.map((r) => ({ ...r })),
    matches: initialMatches.map((m) => ({ ...m })),
  };
  let nextMatchSeq = 1;

  const persistence: EnginePersistence = {
    fetchTournamentById: async (id) => (store.tournament.id === id ? { ...store.tournament } : null),
    fetchTournamentsByStatus: async (statuses) =>
      statuses.includes(store.tournament.status) ? [{ ...store.tournament }] : [],
    fetchRegistrations: async (tid) => (store.tournament.id === tid ? store.regs.map((r) => ({ ...r })) : []),
    fetchRegistrationsWithProfile: async (tid) =>
      store.tournament.id === tid
        ? store.regs.map((r) => ({
            ...r,
            username: `user-${r.user_id.slice(-1)}`,
            rating: 1000 + parseInt(r.user_id.slice(-1), 10) * 100,
          }))
        : [],
    fetchMatches: async (tid) => store.matches.filter((m) => m.tournament_id === tid).map((m) => ({ ...m })),
    fetchMatchById: async (id) => {
      const m = store.matches.find((x) => x.id === id);
      return m ? { ...m } : null;
    },
    fetchMatchByRoomCode: async (code) => {
      const m = store.matches.find((x) => x.room_code === code);
      return m ? { ...m } : null;
    },
    insertMatch: async (input) => {
      const row: MatchRow = {
        id: `m-${nextMatchSeq++}`,
        tournament_id: input.tournamentId,
        round: input.round,
        match_number: input.matchNumber,
        player1_id: input.player1Id,
        player2_id: input.player2Id,
        winner_id: null,
        room_code: input.roomCode,
        status: input.status,
        ready_at: null,
        ready_deadline_at: null,
        started_at: null,
        completed_at: null,
        player1_joined_at: null,
        player2_joined_at: null,
        winner_source: null,
        status_reason: null,
        forfeit_user_id: null,
        no_show_user_id: null,
        bot_tier: input.botTier ?? null,
        player1_score: null,
        player2_score: null,
      };
      store.matches.push(row);
      return { ...row };
    },
    updateMatch: async (id, patch) => {
      const m = store.matches.find((x) => x.id === id);
      if (!m) return;
      Object.assign(m, patch);
    },
    ...inMemoryMatchRpcForArrayStore(store),
    updateRegistrationStatus: async (_tid, userId, status, seed) => {
      const r = store.regs.find((x) => x.user_id === userId);
      if (!r) return;
      r.status = status;
      if (seed !== undefined) r.seed = seed;
    },
    updateRegistrationPlacement: async (_tid, userId, placement) => {
      const r = store.regs.find((x) => x.user_id === userId);
      if (!r) return;
      r.placement = placement;
    },
    updateTournamentStatus: async (_id, status, extra) => {
      store.tournament.status = status;
      if (extra?.winner_id !== undefined) store.tournament.winner_id = extra.winner_id;
    },
    createReservedRoom: vi.fn((_code: string) => ({} as any)),
    getRoom: vi.fn((_code: string) => {
      throw new Error('not implemented in test');
    }),
  };

  return { persistence, store };
}

const baseMatch = (over: Partial<MatchRow>): MatchRow => ({
  id: over.id ?? 'm-x',
  tournament_id: 'tour-1',
  round: 1,
  match_number: 1,
  player1_id: null,
  player2_id: null,
  winner_id: null,
  room_code: null,
  status: 'waiting',
  ready_at: null,
  ready_deadline_at: null,
  started_at: null,
  completed_at: null,
  player1_joined_at: null,
  player2_joined_at: null,
  winner_source: null,
  status_reason: null,
  forfeit_user_id: null,
  no_show_user_id: null,
  bot_tier: null,
  player1_score: null,
  player2_score: null,
  ...over,
});

beforeEach(() => {
  capturedLogs.length = 0;
  vi.clearAllMocks();
});

// ── 1. Redundant producers on one match ─────────────────────────────────────

describe('redundant producers on one match (T-INV-1/2/3/5)', () => {
  async function buildBracketToQfInProgress() {
    const tournament = makeTournament();
    const regs = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8'].map((u) => makeReg(u));
    const { persistence, store } = makePersistence(tournament, regs);
    const { io } = makeIoMock();
    await generateBracket(io, 'tour-1', persistence);
    await dispatchScheduledStartMatches(io, 'tour-1', persistence, new Date('2026-05-15T00:00:01Z'));
    const qf0 = store.matches.filter((m) => m.round === 1).sort((a, b) => a.match_number - b.match_number)[0];
    return { io, persistence, store, qf0 };
  }

  it('same winner from three redundant producers — one completion, no advancement duplicated, no conflict log', async () => {
    const { io, persistence, store, qf0 } = await buildBracketToQfInProgress();
    const winner = qf0.player1_id!;

    // Producer 1: real game-over (promotes ready -> in_progress, then applies).
    await recordMatchResultForTest(
      io,
      { matchId: qf0.id, winnerId: winner, player1Score: 30, player2Score: 12, winnerSource: 'game_over' },
      persistence,
    );
    // Producer 2: forfeit-on-leave arriving just after — same winner (the
    // opponent forfeited to the player who, in this run, also finished first).
    await applyMatchResult(
      io,
      { matchId: qf0.id, winnerId: winner, player1Score: 30, player2Score: 0, winnerSource: 'forfeit' },
      persistence,
    );
    // Producer 3: the no-show reconciler tick landing on the same match.
    await applyMatchResult(
      io,
      { matchId: qf0.id, winnerId: winner, player1Score: 30, player2Score: 0, winnerSource: 'no_show' },
      persistence,
    );

    const finalRow = store.matches.find((m) => m.id === qf0.id)!;
    expect(finalRow.status).toBe('completed');
    expect(finalRow.winner_id).toBe(winner);
    // T-INV-3: the FIRST recorded source wins — later producers don't overwrite it.
    expect(finalRow.winner_source).toBe('game_over');

    // T-INV-5: exactly one advancement — the winner appears in the SF feeder
    // slot exactly once (a duplicate advancement would not be detectable by
    // presence alone, so also check no other SF slot references this winner
    // via more than the one expected target).
    const sfSlotsWithWinner = store.matches
      .filter((m) => m.round === 2)
      .flatMap((m) => [m.player1_id, m.player2_id])
      .filter((id) => id === winner);
    expect(sfSlotsWithWinner).toHaveLength(1);

    const conflictLogs = capturedLogs.filter((l) => l.event === 'tournament_match_winner_conflict');
    expect(conflictLogs).toHaveLength(0);

    assertBracketConsistentForStore(store, {
      capturedLogs,
      expectedConflictLogs: 0,
      context: 'harness:redundant-producers-same-winner',
    });
  });

  it('conflicting winners from redundant producers — first recorded wins, each disagreement logged once (D-3)', async () => {
    const { io, persistence, store, qf0 } = await buildBracketToQfInProgress();
    const recordedWinner = qf0.player1_id!;
    const otherPlayer = qf0.player2_id!;

    await recordMatchResultForTest(
      io,
      { matchId: qf0.id, winnerId: recordedWinner, player1Score: 30, player2Score: 12, winnerSource: 'game_over' },
      persistence,
    );
    // Two more producers disagree with the recorded winner.
    await applyMatchResult(
      io,
      { matchId: qf0.id, winnerId: otherPlayer, player1Score: 30, player2Score: 0, winnerSource: 'forfeit' },
      persistence,
    );
    await applyMatchResult(
      io,
      { matchId: qf0.id, winnerId: otherPlayer, player1Score: 30, player2Score: 0, winnerSource: 'no_show' },
      persistence,
    );

    const finalRow = store.matches.find((m) => m.id === qf0.id)!;
    expect(finalRow.winner_id).toBe(recordedWinner);

    const conflictLogs = capturedLogs.filter((l) => l.event === 'tournament_match_winner_conflict');
    expect(conflictLogs).toHaveLength(2);
    for (const l of conflictLogs) {
      expect(l.recordedWinnerId).toBe(recordedWinner);
      expect(l.attemptedWinnerId).toBe(otherPlayer);
    }

    assertBracketConsistentForStore(store, {
      capturedLogs,
      expectedConflictLogs: 2,
      context: 'harness:redundant-producers-conflicting-winners',
    });
  });
});

// ── 2. Recovery: RPC committed, Node post-processing never ran ─────────────

describe('recovery after the RPC committed but Node post-processing did not run', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T00:10:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('recoverTournamentMatches dispatches a room for a target match the RPC advanced but nothing ever dispatched', async () => {
    const tournament = makeTournament();
    const regs = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8'].map((u) => makeReg(u, { status: 'active' }));
    const matches: MatchRow[] = [
      baseMatch({
        id: 'qf1', round: 1, match_number: 1, player1_id: 'u1', player2_id: 'u2',
        status: 'in_progress', room_code: 'RQF1', started_at: '2026-05-15T00:01:00Z',
      }),
      baseMatch({
        id: 'qf2', round: 1, match_number: 2, player1_id: 'u3', player2_id: 'u4',
        status: 'in_progress', room_code: 'RQF2', started_at: '2026-05-15T00:01:00Z',
      }),
      // Full 7-row bracket — the two feeders above are what this test
      // exercises; qf3/qf4 stay untouched (still waiting on their own players).
      baseMatch({
        id: 'qf3', round: 1, match_number: 3, player1_id: 'u5', player2_id: 'u6',
        status: 'waiting',
      }),
      baseMatch({
        id: 'qf4', round: 1, match_number: 4, player1_id: 'u7', player2_id: 'u8',
        status: 'waiting',
      }),
      baseMatch({ id: 'sf1', round: 2, match_number: 1 }),
      baseMatch({ id: 'sf2', round: 2, match_number: 2 }),
      baseMatch({ id: 'final', round: 3, match_number: 1 }),
    ];
    const { persistence, store } = makePersistence(tournament, regs, matches);

    // Simulate "the RPC committed" by calling completeTournamentMatch directly
    // — the low-level call `applyMatchResult` makes — WITHOUT going through
    // applyMatchResult's own post-processing (socket emit, dispatch the newly-
    // ready target). That is exactly the gap a crash between "RPC commits" and
    // "Node finishes handling the result" leaves behind.
    await persistence.completeTournamentMatch({
      matchId: 'qf1', winnerId: 'u1', winnerSource: 'game_over',
      reportedPlayer1Score: 30, reportedPlayer2Score: 10,
    });
    await persistence.completeTournamentMatch({
      matchId: 'qf2', winnerId: 'u3', winnerSource: 'game_over',
      reportedPlayer1Score: 30, reportedPlayer2Score: 14,
    });

    const sf1BeforeRecovery = store.matches.find((m) => m.id === 'sf1')!;
    expect(sf1BeforeRecovery.status).toBe('ready'); // both feeders done, RPC advanced it
    expect(sf1BeforeRecovery.room_code).toBeNull(); // but nothing ever dispatched a room

    const { io } = makeIoMock();
    const result = await recoverTournamentMatches(io, persistence);

    expect(result.readyRecovered).toBe(1);
    const sf1AfterRecovery = store.matches.find((m) => m.id === 'sf1')!;
    expect(sf1AfterRecovery.room_code).toBeTruthy();

    assertBracketConsistentForStore(store, { context: 'harness:recovery-committed-not-dispatched' });
  });
});

// ── 3. Reconciler survives a corrupt/missing advancement target ────────────

describe('reconciler tick survives advance_target_missing without aborting', () => {
  it('logs and continues past a match with no advancement target, still resolving the next one', async () => {
    const tournament = makeTournament();
    const regs = ['u1', 'u3', 'u4', 'u6'].map((u) => makeReg(u, { status: 'active', seed: 1 }));
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    const matches: MatchRow[] = [
      // round1/match1's advancement target (round2/match1) is deliberately
      // absent from the store — a corrupt/partial bracket.
      baseMatch({
        id: 'm-missing-target', round: 1, match_number: 1, player1_id: 'u4', player2_id: 'u1',
        status: 'ready', ready_at: expiredAt, ready_deadline_at: expiredAt, player1_joined_at: expiredAt,
        room_code: 'R1',
      }),
      // round1/match3's target (round2/match2) IS present — proves the tick
      // still processes and advances normally after hitting the missing one.
      baseMatch({
        id: 'm-normal', round: 1, match_number: 3, player1_id: 'u6', player2_id: 'u3',
        status: 'ready', ready_at: expiredAt, ready_deadline_at: expiredAt, player1_joined_at: expiredAt,
        room_code: 'R3',
      }),
      baseMatch({ id: 'sf2', round: 2, match_number: 2 }),
    ];
    const { persistence, store } = makePersistence(tournament, regs, matches);
    (persistence.getRoom as any).mockReturnValue({ code: 'R', players: [], state: null });
    const { io } = makeIoMock();

    const resolved = await reconcileExpiredReadyMatches(io, new Date(), persistence);

    expect(resolved).toBe(2);

    const missing = store.matches.find((m) => m.id === 'm-missing-target')!;
    expect(missing.status).toBe('completed');
    expect(missing.winner_id).toBe('u4');

    const normal = store.matches.find((m) => m.id === 'm-normal')!;
    expect(normal.status).toBe('completed');
    expect(normal.winner_id).toBe('u6');
    const sf2 = store.matches.find((m) => m.id === 'sf2')!;
    expect(sf2.player1_id).toBe('u6'); // normal advancement still happened

    const missingTargetLogs = capturedLogs.filter((l) => l.event === 'tournament_advance_target_missing');
    expect(missingTargetLogs).toHaveLength(1);
    expect(missingTargetLogs[0].matchId).toBe('m-missing-target');

    // The bracket is deliberately partial/corrupt here (that's the point of
    // the test), so assertBracketConsistent's shape checks (7 rows, 4/2/1 by
    // round) fail on purpose — assert only that the *specific* violation this
    // test is about is present, and that neither completed match's own
    // winner/participant/elimination integrity is broken by the missing target.
    const violations = collectBracketConsistencyViolations({
      tournament: store.tournament,
      matches: store.matches,
      registrations: store.regs,
    });
    expect(violations.some((v) => v.includes('has no advancement target row'))).toBe(true);
    expect(violations.some((v) => v.includes('not a participant'))).toBe(false);
    expect(violations.some((v) => v.includes('expected eliminated'))).toBe(false);
    expect(violations.some((v) => v.includes('is not in'))).toBe(false);
  });
});

// ── 4. Cold-wake catch-up — processing order must not change the outcome ───

describe('cold-wake catch-up tick — order independence (§1.4.8)', () => {
  function buildFourExpiredQfs(order: number[]) {
    const tournament = makeTournament();
    const regs = [
      makeReg('u1', { status: 'active', seed: 1 }),
      makeReg('u2', { status: 'active', seed: 2 }),
      makeReg('u3', { status: 'active', seed: 3 }),
      makeReg('u4', { status: 'active', seed: 4 }),
      makeReg('u5', { status: 'active', seed: 5 }),
      makeReg('u6', { status: 'active', seed: 6 }),
      makeReg('u7', { status: 'active', seed: 7 }),
      makeReg('u8', { status: 'active', seed: 8 }),
    ];
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    // Both players absent (no player1_joined_at) on every QF -> double no-show
    // -> higher seed (lower seed number) advances, deterministic regardless
    // of tick processing order.
    const qfDefs: Array<[string, string, number]> = [
      ['u1', 'u8', 1], ['u4', 'u5', 2], ['u3', 'u6', 3], ['u2', 'u7', 4],
    ];
    const qfRows = qfDefs.map(([p1, p2, n]) =>
      baseMatch({
        id: `qf${n}`, round: 1, match_number: n, player1_id: p1, player2_id: p2,
        status: 'ready', ready_at: expiredAt, ready_deadline_at: expiredAt, room_code: `RQF${n}`,
      }),
    );
    const sfFinalRows = [
      baseMatch({ id: 'sf1', round: 2, match_number: 1 }),
      baseMatch({ id: 'sf2', round: 2, match_number: 2 }),
      baseMatch({ id: 'final', round: 3, match_number: 1 }),
    ];
    // Apply the requested processing order to the 4 QF rows; SF/Final always
    // come after in array order (they're not overdue yet at tick start).
    const orderedQfs = order.map((i) => qfRows[i]);
    const matches = [...orderedQfs, ...sfFinalRows];
    return makePersistence(tournament, regs, matches);
  }

  it('produces an identical bracket end-state whether the batch is processed forward or reversed', async () => {
    const forward = buildFourExpiredQfs([0, 1, 2, 3]);
    const reversed = buildFourExpiredQfs([3, 2, 1, 0]);

    const { io: ioA } = makeIoMock();
    const { io: ioB } = makeIoMock();
    (forward.persistence.getRoom as any).mockReturnValue({ code: 'R', players: [], state: null });
    (reversed.persistence.getRoom as any).mockReturnValue({ code: 'R', players: [], state: null });

    const [resolvedA, resolvedB] = await Promise.all([
      reconcileExpiredReadyMatches(ioA, new Date(), forward.persistence),
      reconcileExpiredReadyMatches(ioB, new Date(), reversed.persistence),
    ]);
    expect(resolvedA).toBe(4);
    expect(resolvedB).toBe(4);

    const signature = (store: typeof forward.store) => ({
      qfWinners: store.matches
        .filter((m) => m.round === 1)
        .sort((a, b) => a.match_number - b.match_number)
        .map((m) => m.winner_id),
      sf1: [store.matches.find((m) => m.id === 'sf1')!.player1_id, store.matches.find((m) => m.id === 'sf1')!.player2_id],
      sf2: [store.matches.find((m) => m.id === 'sf2')!.player1_id, store.matches.find((m) => m.id === 'sf2')!.player2_id],
      sfStatuses: store.matches.filter((m) => m.round === 2).map((m) => m.status),
      eliminated: store.regs.filter((r) => r.status === 'eliminated').map((r) => r.user_id).sort(),
    });

    expect(signature(forward.store)).toEqual(signature(reversed.store));

    assertBracketConsistentForStore(forward.store, { context: 'harness:cold-wake-forward' });
    assertBracketConsistentForStore(reversed.store, { context: 'harness:cold-wake-reversed' });
  });

  it('produces the same end-state for a third, shuffled order too', async () => {
    const a = buildFourExpiredQfs([0, 1, 2, 3]);
    const shuffled = buildFourExpiredQfs([2, 0, 3, 1]);
    const { io: ioA } = makeIoMock();
    const { io: ioB } = makeIoMock();
    (a.persistence.getRoom as any).mockReturnValue({ code: 'R', players: [], state: null });
    (shuffled.persistence.getRoom as any).mockReturnValue({ code: 'R', players: [], state: null });

    await reconcileExpiredReadyMatches(ioA, new Date(), a.persistence);
    await reconcileExpiredReadyMatches(ioB, new Date(), shuffled.persistence);

    const winnersOf = (store: typeof a.store) =>
      Object.fromEntries(
        store.matches.filter((m) => m.round === 1).map((m) => [m.id, m.winner_id]),
      );
    expect(winnersOf(a.store)).toEqual(winnersOf(shuffled.store));
    assertBracketConsistentForStore(shuffled.store, { context: 'harness:cold-wake-shuffled' });
  });
});
