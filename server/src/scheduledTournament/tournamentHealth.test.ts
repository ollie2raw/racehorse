/**
 * Phase 1 "make events safe" — the tournament review's appendix scenarios
 * (docs/tournament-review.md, C1–C5), rewritten to assert the fixed behavior.
 *
 * These drive the real engine against the in-memory port of the match RPCs
 * (inMemoryMatchRpc.testkit.ts), including generate_tournament_bracket v2.
 * Database-level guarantees that an in-memory store cannot prove — the seat cap
 * under two concurrent sessions, registration after the close time, withdraw
 * after start, and the RPC's partial-bracket repair — are exercised against a
 * real Postgres 16 by scripts/tournament-db-verify.sh.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../social/activityWriter', () => ({
  writeTournamentActivity: vi.fn().mockResolvedValue(undefined),
}));

const dispatchCalls = vi.hoisted(() => [] as Array<{ matchId: string; opts: unknown }>);

vi.mock('./matchDispatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./matchDispatch')>();
  return {
    ...actual,
    dispatchTournamentMatch: vi.fn(async (_io, matchId: string, opts, persistence) => {
      dispatchCalls.push({ matchId, opts });
      const match = await persistence.fetchMatchById(matchId);
      return {
        ok: true,
        matchId,
        tournamentId: match?.tournament_id ?? 'tour-1',
        roomCode: match?.room_code ?? '',
        status: 'ready',
        readyAt: match?.ready_at ?? null,
        readyDeadlineAt: match?.ready_deadline_at ?? null,
        recipients: [],
        reusedExistingRoom: true,
        emittedReady: true,
      };
    }),
  };
});

import {
  BOTH_JOINED_START_RETRY_REASON,
  closeRegistrationAndStart,
  generateBracket,
  reconcileExpiredReadyMatches,
} from './engine';
import type { EnginePersistence } from './persistenceInterface';
import { inMemoryMatchRpcForArrayStore } from './inMemoryMatchRpc.testkit';
import type { MatchRow, RegistrationRow, ScheduledTournamentRow } from './types';

type Store = { tournament: ScheduledTournamentRow; regs: RegistrationRow[]; matches: MatchRow[] };

function makeIo() {
  const events: Array<{ event: string; payload: unknown }> = [];
  const io = {
    emit: (event: string, payload: unknown) => events.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as unknown as import('socket.io').Server;
  return { io, events };
}

function makeTournament(overrides: Partial<ScheduledTournamentRow> = {}): ScheduledTournamentRow {
  return {
    id: 'tour-1',
    scheduled_start: '2026-05-15T00:00:00.000Z',
    registration_open_at: '2026-05-14T23:30:00.000Z',
    registration_close_at: '2026-05-14T23:58:00.000Z',
    status: 'registration_open',
    format: '7-tile',
    win_target: 30,
    max_players: 8,
    winner_id: null,
    created_at: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeReg(userId: string, status: RegistrationRow['status'] = 'registered'): RegistrationRow {
  return {
    id: `reg-${userId}`,
    tournament_id: 'tour-1',
    user_id: userId,
    registered_at: '2026-05-14T23:40:00.000Z',
    seed: null,
    placement: null,
    status,
  };
}

function blankMatch(id: string, round: 1 | 2 | 3, matchNumber: number, overrides: Partial<MatchRow> = {}): MatchRow {
  return {
    id,
    tournament_id: 'tour-1',
    round,
    match_number: matchNumber,
    player1_id: null,
    player2_id: null,
    winner_id: null,
    room_code: '',
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
    ...overrides,
  };
}

/**
 * Ratings climb with the user number: u1 = 1100, u2 = 1200, ... so the
 * highest-numbered registrant is the top seed, independent of registration order.
 */
function makePersistence(store: Store, roomStateByCode: Record<string, unknown> = {}): EnginePersistence {
  const rpc = inMemoryMatchRpcForArrayStore(store);
  return {
    fetchTournamentById: async (id) => (store.tournament.id === id ? { ...store.tournament } : null),
    fetchTournamentsByStatus: async (statuses) =>
      statuses.includes(store.tournament.status) ? [{ ...store.tournament }] : [],
    fetchRegistrations: async () => store.regs.map((r) => ({ ...r })),
    fetchRegistrationsWithProfile: async () =>
      store.regs.map((r) => ({
        ...r,
        username: r.user_id,
        rating: 1000 + parseInt(r.user_id.slice(1), 10) * 100,
      })),
    fetchMatches: async () => store.matches.map((m) => ({ ...m })),
    fetchMatchById: async (id) => {
      const m = store.matches.find((x) => x.id === id);
      return m ? { ...m } : null;
    },
    fetchMatchByRoomCode: async (code) => {
      const m = store.matches.find((x) => x.room_code === code);
      return m ? { ...m } : null;
    },
    updateMatch: async (id, patch) => {
      const m = store.matches.find((x) => x.id === id);
      if (m) Object.assign(m, patch);
    },
    ...rpc,
    updateRegistrationPlacement: async (_tid, userId, placement) => {
      const r = store.regs.find((x) => x.user_id === userId);
      if (r) r.placement = placement;
    },
    updateTournamentStatus: async (_id, status, extra) => {
      store.tournament.status = status;
      if (extra?.winner_id !== undefined) store.tournament.winner_id = extra.winner_id;
      if (extra?.cancel_reason !== undefined) store.tournament.cancel_reason = extra.cancel_reason;
    },
    createReservedRoom: vi.fn(() => ({}) as never),
    getRoom: vi.fn((code: string) => {
      if (!(code in roomStateByCode)) throw new Error('room_not_found');
      return { code, state: roomStateByCode[code] } as never;
    }),
  };
}

beforeEach(() => {
  dispatchCalls.length = 0;
});

// ── A1 / review C4: a crash mid-creation no longer strands the tournament ────
describe('A1: bracket creation is atomic and a retry repairs partial state', () => {
  it('repairs the 4-of-7 bracket the old insert-by-insert path left behind', async () => {
    // What C4 produced: QF rows inserted, then a crash before SF/F, the
    // registration updates and the status change.
    const store: Store = {
      tournament: makeTournament(),
      regs: [makeReg('u1'), makeReg('u2')],
      matches: [1, 2, 3, 4].map((n) => blankMatch(`old-qf${n}`, 1, n, { player1_id: 'u2', player2_id: `bot:fritz:tour-1:${n}` })),
    };
    const { io, events } = makeIo();

    const result = await closeRegistrationAndStart(io, 'tour-1', makePersistence(store));

    expect(result).toEqual({ started: true });
    expect(store.matches).toHaveLength(7);
    expect(store.matches.filter((m) => m.id.startsWith('old-'))).toHaveLength(0);
    expect(store.tournament.status).toBe('in_progress');
    expect(store.regs.every((r) => r.status === 'active')).toBe(true);
    expect(events.filter((e) => e.event === 'tournament:bracket_generated')).toHaveLength(1);
  });

  it('a failed generation writes nothing, and the retry builds the whole bracket', async () => {
    const store: Store = { tournament: makeTournament(), regs: [makeReg('u1')], matches: [] };
    const persistence = makePersistence(store);
    const real = persistence.generateTournamentBracket;
    let calls = 0;
    persistence.generateTournamentBracket = async (params) => {
      calls += 1;
      // One transaction: a failure rolls everything back, so nothing is written.
      if (calls === 1) throw new Error('simulated crash');
      return real(params);
    };
    const { io } = makeIo();

    await expect(closeRegistrationAndStart(io, 'tour-1', persistence)).rejects.toThrow('simulated crash');
    expect(store.matches).toHaveLength(0);
    expect(store.tournament.status).toBe('registration_open');

    await expect(closeRegistrationAndStart(io, 'tour-1', persistence)).resolves.toEqual({ started: true });
    expect(store.matches).toHaveLength(7);
    expect(store.tournament.status).toBe('in_progress');
  });

  it('a retry after success is a no-op: same rows, no second broadcast', async () => {
    const store: Store = { tournament: makeTournament(), regs: [makeReg('u1')], matches: [] };
    const persistence = makePersistence(store);
    const { io, events } = makeIo();
    await generateBracket(io, 'tour-1', persistence);
    const ids = store.matches.map((m) => m.id).sort();

    await generateBracket(io, 'tour-1', persistence);

    expect(store.matches.map((m) => m.id).sort()).toEqual(ids);
    expect(events.filter((e) => e.event === 'tournament:bracket_generated')).toHaveLength(1);
  });

  it('refuses to paper over a bracket that was already played', async () => {
    const store: Store = {
      tournament: makeTournament(),
      regs: [makeReg('u1')],
      matches: [blankMatch('played', 1, 1, { status: 'completed', winner_id: 'u1' })],
    };
    const { io } = makeIo();
    await expect(generateBracket(io, 'tour-1', makePersistence(store))).rejects.toThrow('bracket_partial_conflict');
    expect(store.matches).toHaveLength(1);
  });

  it('a registration that lands mid-generation is picked up by one re-read', async () => {
    const store: Store = { tournament: makeTournament(), regs: [makeReg('u1')], matches: [] };
    const persistence = makePersistence(store);
    const readOnce = persistence.fetchRegistrationsWithProfile;
    let reads = 0;
    persistence.fetchRegistrationsWithProfile = async (tid) => {
      const rows = await readOnce(tid);
      reads += 1;
      // u2 registers between our first read and the RPC's lock.
      if (reads === 1) store.regs.push(makeReg('u2'));
      return rows;
    };
    const { io } = makeIo();

    await generateBracket(io, 'tour-1', persistence);

    expect(reads).toBe(2);
    expect(store.regs.map((r) => [r.user_id, r.status])).toEqual([['u1', 'active'], ['u2', 'active']]);
    const humans = store.matches.flatMap((m) => [m.player1_id, m.player2_id]).filter((id) => id === 'u1' || id === 'u2');
    expect(humans.sort()).toEqual(['u1', 'u2']);
  });
});

// ── A2 / review C1: an over-full field cannot build (and no longer loops) ────
describe('A2: the seat cap', () => {
  it('a 9-player field (only possible from the old racy insert) is rejected cleanly and leaves no rows', async () => {
    const store: Store = {
      tournament: makeTournament(),
      regs: Array.from({ length: 9 }, (_, i) => makeReg(`u${i + 1}`)),
      matches: [],
    };
    const { io } = makeIo();

    await expect(closeRegistrationAndStart(io, 'tour-1', makePersistence(store))).rejects.toThrow();

    expect(store.matches).toHaveLength(0);
    expect(store.tournament.status).toBe('registration_open');
    // The scheduler now alerts and cancels this after N consecutive failures
    // instead of retrying forever: see closeRegistrationWithEscalation in
    // scheduler.test.ts. New registrations can no longer produce this state:
    // register_for_tournament enforces the cap under a row lock
    // (scripts/tournament-db-verify.sh, "concurrent last seat").
  });

  it('the bracket RPC itself refuses more seeds than seats', async () => {
    const store: Store = { tournament: makeTournament({ max_players: 2 }), regs: [makeReg('u1'), makeReg('u2'), makeReg('u3')], matches: [] };
    const persistence = makePersistence(store);
    await expect(persistence.generateTournamentBracket({
      tournamentId: 'tour-1',
      qfPairs: [],
      seeds: [{ user_id: 'u1', seed: 1 }, { user_id: 'u2', seed: 2 }, { user_id: 'u3', seed: 3 }],
    })).rejects.toThrow('tournament_full');
    expect(store.matches).toHaveLength(0);
  });
});

// ── B8 / review C3: stored seeds are the bracket's seeds ──────────────────────
describe('B8: stored seeds match the bracket order', () => {
  it('seeds by rating, not registration order', async () => {
    // Registered u1, u2, u3 in that order; u3 has the highest rating.
    const store: Store = { tournament: makeTournament(), regs: [makeReg('u1'), makeReg('u2'), makeReg('u3')], matches: [] };
    const { io } = makeIo();

    await closeRegistrationAndStart(io, 'tour-1', makePersistence(store));

    const seedOf = Object.fromEntries(store.regs.map((r) => [r.user_id, r.seed]));
    expect(seedOf).toEqual({ u3: 1, u2: 2, u1: 3 });
    const qf1 = store.matches.find((m) => m.round === 1 && m.match_number === 1)!;
    expect(qf1.player1_id).toBe('u3');
    expect(qf1.player2_id).toMatch(/^bot:fritz:/);
  });
});

// ── A6 / review C5: present players are not resolved as no-shows ────────────
describe('A6: all players joined but the game never started', () => {
  const PAST_DEADLINE = new Date('2026-05-15T00:03:00.000Z');

  function readyBothJoined(): Store {
    return {
      tournament: makeTournament({ status: 'in_progress' }),
      regs: [makeReg('u1', 'active'), makeReg('u2', 'active')],
      matches: [
        blankMatch('qf1', 1, 1, {
          player1_id: 'u1',
          player2_id: 'u2',
          status: 'ready',
          room_code: 'T1R1M1',
          ready_at: '2026-05-15T00:00:00.000Z',
          ready_deadline_at: '2026-05-15T00:02:00.000Z',
          player1_joined_at: '2026-05-15T00:00:30.000Z',
          player2_joined_at: '2026-05-15T00:00:40.000Z',
        }),
      ],
    };
  }

  it('extends the deadline once and re-sends match_ready instead of resolving by seed', async () => {
    const store = readyBothJoined();
    const { io } = makeIo();

    const resolved = await reconcileExpiredReadyMatches(io, PAST_DEADLINE, makePersistence(store, { T1R1M1: null }));

    const qf1 = store.matches[0];
    expect(resolved).toBe(0);
    expect(qf1.status).toBe('ready');
    expect(qf1.winner_id).toBeNull();
    expect(qf1.status_reason).toBe(BOTH_JOINED_START_RETRY_REASON);
    expect(Date.parse(qf1.ready_deadline_at!)).toBe(PAST_DEADLINE.getTime() + 2 * 60 * 1000);
    expect(dispatchCalls).toEqual([{ matchId: 'qf1', opts: { reason: 'repair', emitIfAlreadyReady: true } }]);
  });

  it('a game that starts during the extension goes in_progress', async () => {
    const store = readyBothJoined();
    const { io } = makeIo();
    const rooms: Record<string, unknown> = { T1R1M1: null };
    const persistence = makePersistence(store, rooms);
    await reconcileExpiredReadyMatches(io, PAST_DEADLINE, persistence);

    rooms.T1R1M1 = { phase: 'playing' }; // the re-attach started the game
    await reconcileExpiredReadyMatches(io, new Date(PAST_DEADLINE.getTime() + 3 * 60 * 1000), persistence);

    expect(store.matches[0].status).toBe('in_progress');
    expect(store.matches[0].winner_id).toBeNull();
  });

  it('only a second expiry resolves, and it is not recorded as a double no-show', async () => {
    const store = readyBothJoined();
    const { io } = makeIo();
    const persistence = makePersistence(store, { T1R1M1: null });
    await reconcileExpiredReadyMatches(io, PAST_DEADLINE, persistence);

    const resolved = await reconcileExpiredReadyMatches(io, new Date(PAST_DEADLINE.getTime() + 3 * 60 * 1000), persistence);

    const qf1 = store.matches[0];
    expect(resolved).toBe(1);
    expect(dispatchCalls).toHaveLength(1);
    expect(qf1.status).toBe('completed');
    expect(qf1.status_reason).toBe('start_failed_after_retry_higher_seed_advanced');
    expect(qf1.no_show_user_id).toBeNull();
  });

  it('a genuine double no-show is still resolved on the first expiry', async () => {
    const store = readyBothJoined();
    store.matches[0].player1_joined_at = null;
    store.matches[0].player2_joined_at = null;
    const { io } = makeIo();

    const resolved = await reconcileExpiredReadyMatches(io, PAST_DEADLINE, makePersistence(store, { T1R1M1: null }));

    expect(resolved).toBe(1);
    expect(dispatchCalls).toHaveLength(0);
    expect(store.matches[0].status_reason).toBe('double_no_show_higher_seed_advanced');
  });
});

// ── A3 / review C2 ────────────────────────────────────────────────────────────
describe('A3: an absent human against bots', () => {
  // Deliberately not changed in Phase 1: whether a never-joined player may be
  // crowned is a product decision (review Part 4.4, question 1).
  it.todo('does not crown a player who never joined (pending the A3 product decision)');
});
