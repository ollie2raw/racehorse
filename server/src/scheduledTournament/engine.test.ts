import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateBracket,
  applyMatchResult,
  closeRegistrationAndStart,
  cancelTournament,
} from './engine';
import type { EnginePersistence } from './persistenceInterface';
import type {
  MatchRow,
  RegistrationRow,
  ScheduledTournamentRow,
  MatchStatus,
} from './types';

// ── In-memory persistence + minimal io mock ──────────────────────────────────

type EmittedEvent = { target: 'global' | string; event: string; payload: unknown };

function makeIoMock() {
  const events: EmittedEvent[] = [];
  const sockets: Array<{ id: string; data: { userId?: string }; emit: (e: string, p: unknown) => void }> = [];
  const io = {
    emit: (event: string, payload: unknown) => {
      events.push({ target: 'global', event, payload });
    },
    sockets: { sockets: new Map(sockets.map((s) => [s.id, s])) },
  } as unknown as import('socket.io').Server;
  return { io, events };
}

function makePersistence(
  tournament: ScheduledTournamentRow,
  initialRegs: RegistrationRow[],
): { persistence: EnginePersistence; store: { matches: MatchRow[]; regs: RegistrationRow[]; tournament: ScheduledTournamentRow } } {
  const store = {
    tournament: { ...tournament },
    regs: initialRegs.map((r) => ({ ...r })),
    matches: [] as MatchRow[],
  };
  let nextMatchSeq = 1;

  const persistence: EnginePersistence = {
    fetchTournamentById: async (id) =>
      store.tournament.id === id ? { ...store.tournament } : null,
    fetchRegistrations: async (tid) =>
      store.tournament.id === tid ? store.regs.map((r) => ({ ...r })) : [],
    fetchRegistrationsWithProfile: async (tid) =>
      store.tournament.id === tid
        ? store.regs.map((r) => ({
            ...r,
            // Synthetic username/rating: just echo user_id + 1000-rating ladder.
            username: `user-${r.user_id.slice(-1)}`,
            rating: 1000 + parseInt(r.user_id.slice(-1), 10) * 100,
          }))
        : [],
    fetchMatches: async (tid) =>
      store.matches
        .filter((m) => m.tournament_id === tid)
        .map((m) => ({ ...m })),
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
        started_at: null,
        completed_at: null,
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
    updateRegistrationStatus: async (_tid, userId, status, seed) => {
      const r = store.regs.find((x) => x.user_id === userId);
      if (!r) return;
      r.status = status;
      if (seed !== undefined) r.seed = seed;
    },
    updateTournamentStatus: async (_id, status, extra) => {
      store.tournament.status = status;
      if (extra?.winner_id !== undefined) store.tournament.winner_id = extra.winner_id;
    },
    // Room infrastructure mocks — return shape-only stubs.
    createReservedRoom: vi.fn((_code: string, _config: unknown) => ({} as any)),
    getRoom: vi.fn((_code: string) => {
      // Throw to mirror the "room not found" branch in the engine. The engine
      // catches this case during testing (it's only used to tag the in-memory
      // room with the match id, which doesn't matter for the persistence test).
      throw new Error('not implemented in test');
    }),
  };

  return { persistence, store };
}

function makeTournament(overrides: Partial<ScheduledTournamentRow> = {}): ScheduledTournamentRow {
  return {
    id: 'tour-1',
    scheduled_start: new Date('2026-05-15T00:00:00Z').toISOString(),
    registration_open_at: new Date('2026-05-14T23:30:00Z').toISOString(),
    registration_close_at: new Date('2026-05-14T23:55:00Z').toISOString(),
    status: 'registration_open',
    format: '7-tile',
    win_target: 30,
    max_players: 8,
    winner_id: null,
    created_at: new Date('2026-05-01T00:00:00Z').toISOString(),
    ...overrides,
  };
}

function makeReg(userId: string): RegistrationRow {
  return {
    id: `reg-${userId}`,
    tournament_id: 'tour-1',
    user_id: userId,
    registered_at: new Date('2026-05-14T23:00:00Z').toISOString(),
    seed: null,
    status: 'registered',
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('closeRegistrationAndStart', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('cancels the tournament when fewer than 4 players are registered', async () => {
    const tournament = makeTournament();
    const regs = [makeReg('u1'), makeReg('u2'), makeReg('u3')];
    const { persistence, store } = makePersistence(tournament, regs);
    const { io, events } = makeIoMock();

    const result = await closeRegistrationAndStart(io, 'tour-1', persistence);

    expect(result).toEqual({ started: false, reason: 'not_enough_players' });
    expect(store.tournament.status).toBe('cancelled');
    expect(events.some((e) => e.event === 'tournament:cancelled')).toBe(true);
    expect(store.matches).toHaveLength(0);
  });

  it('starts the bracket when ≥ 4 players are registered', async () => {
    const tournament = makeTournament();
    const regs = [makeReg('u1'), makeReg('u2'), makeReg('u3'), makeReg('u4')];
    const { persistence, store } = makePersistence(tournament, regs);
    const { io, events } = makeIoMock();

    const result = await closeRegistrationAndStart(io, 'tour-1', persistence);

    expect(result).toEqual({ started: true });
    expect(store.tournament.status).toBe('in_progress');
    expect(store.matches).toHaveLength(7); // 4 QF + 2 SF + 1 Final
    expect(events.some((e) => e.event === 'tournament:bracket_generated')).toBe(true);
  });
});

describe('full bracket lifecycle (4 players)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('drives 4 players through QF → SF → Final, byes auto-advance, one tournament:completed fires', async () => {
    // Ratings: u4=1400, u3=1300, u2=1200, u1=1100 → seeded u4,u3,u2,u1.
    const tournament = makeTournament();
    const regs = [makeReg('u1'), makeReg('u2'), makeReg('u3'), makeReg('u4')];
    const { persistence, store } = makePersistence(tournament, regs);
    const { io, events } = makeIoMock();

    await generateBracket(io, 'tour-1', persistence);

    // 4 QF + 2 SF + 1 Final = 7 rows.
    expect(store.matches.filter((m) => m.round === 1)).toHaveLength(4);
    expect(store.matches.filter((m) => m.round === 2)).toHaveLength(2);
    expect(store.matches.filter((m) => m.round === 3)).toHaveLength(1);

    // Seeding for 4 players: seeds 5,6,7,8 are byes.
    //   QF1: seed1 (u4) vs seed8 (null) → bye   → u4 walks over → SF1.player1
    //   QF2: seed4 (u1) vs seed5 (null) → bye   → u1 walks over → SF1.player2
    //   QF3: seed3 (u2) vs seed6 (null) → bye   → u2 walks over → SF2.player1
    //   QF4: seed2 (u3) vs seed7 (null) → bye   → u3 walks over → SF2.player2
    const qf = store.matches
      .filter((m) => m.round === 1)
      .sort((a, b) => a.match_number - b.match_number);
    expect(qf[0].player1_id).toBe('u4');
    expect(qf[0].player2_id).toBeNull();
    expect(qf[1].player1_id).toBe('u1');
    expect(qf[2].player1_id).toBe('u2');
    expect(qf[3].player1_id).toBe('u3');

    // All QFs should be completed via bye walkovers.
    for (const m of qf) {
      expect(m.status).toBe('completed');
      expect(m.winner_id).toBeTruthy();
    }

    // Both SFs should be 'ready' with both slots filled.
    const sf = store.matches
      .filter((m) => m.round === 2)
      .sort((a, b) => a.match_number - b.match_number);
    expect(sf[0].player1_id).toBe('u4');
    expect(sf[0].player2_id).toBe('u1');
    expect(sf[0].status).toBe('ready');
    expect(sf[1].player1_id).toBe('u2');
    expect(sf[1].player2_id).toBe('u3');
    expect(sf[1].status).toBe('ready');

    // Final still has no players, status waiting.
    const final = store.matches.find((m) => m.round === 3)!;
    expect(final.player1_id).toBeNull();
    expect(final.player2_id).toBeNull();
    expect(final.status).toBe('waiting');

    // ── Play SF1: u4 beats u1 30–25 ──────────────────────────────────────
    await applyMatchResult(io, {
      matchId: sf[0].id, winnerId: 'u4', player1Score: 30, player2Score: 25,
    }, persistence);

    const finalAfterSf1 = store.matches.find((m) => m.round === 3)!;
    expect(finalAfterSf1.player1_id).toBe('u4');
    expect(finalAfterSf1.status).toBe('waiting'); // SF2 still pending

    // u1 should be eliminated.
    expect(store.regs.find((r) => r.user_id === 'u1')?.status).toBe('eliminated');

    // ── Play SF2: u2 beats u3 30–18 ──────────────────────────────────────
    await applyMatchResult(io, {
      matchId: sf[1].id, winnerId: 'u2', player1Score: 30, player2Score: 18,
    }, persistence);

    const finalReady = store.matches.find((m) => m.round === 3)!;
    expect(finalReady.player1_id).toBe('u4');
    expect(finalReady.player2_id).toBe('u2');
    expect(finalReady.status).toBe('ready');
    expect(store.regs.find((r) => r.user_id === 'u3')?.status).toBe('eliminated');

    // ── Play Final: u4 beats u2 30–22 ────────────────────────────────────
    await applyMatchResult(io, {
      matchId: finalReady.id, winnerId: 'u4', player1Score: 30, player2Score: 22,
    }, persistence);

    const finalDone = store.matches.find((m) => m.round === 3)!;
    expect(finalDone.status).toBe('completed');
    expect(finalDone.winner_id).toBe('u4');
    expect(store.tournament.status).toBe('completed');
    expect(store.tournament.winner_id).toBe('u4');
    expect(store.regs.find((r) => r.user_id === 'u4')?.status).toBe('winner');
    expect(store.regs.find((r) => r.user_id === 'u2')?.status).toBe('eliminated');

    // Exactly one tournament:completed event fired.
    const completed = events.filter((e) => e.event === 'tournament:completed');
    expect(completed).toHaveLength(1);
    expect(completed[0].payload).toEqual({ tournamentId: 'tour-1', winnerId: 'u4' });
  });

  it('applyMatchResult is idempotent — replay does not re-fire completed', async () => {
    const tournament = makeTournament();
    const regs = [makeReg('u1'), makeReg('u2'), makeReg('u3'), makeReg('u4')];
    const { persistence, store } = makePersistence(tournament, regs);
    const { io, events } = makeIoMock();

    await generateBracket(io, 'tour-1', persistence);

    const sf = store.matches.filter((m) => m.round === 2).sort((a, b) => a.match_number - b.match_number);
    await applyMatchResult(io, { matchId: sf[0].id, winnerId: 'u4', player1Score: 30, player2Score: 25 }, persistence);
    await applyMatchResult(io, { matchId: sf[1].id, winnerId: 'u2', player1Score: 30, player2Score: 18 }, persistence);
    const final = store.matches.find((m) => m.round === 3)!;
    await applyMatchResult(io, { matchId: final.id, winnerId: 'u4', player1Score: 30, player2Score: 22 }, persistence);

    const before = events.filter((e) => e.event === 'tournament:completed').length;
    // Re-apply the final result — should be a no-op.
    await applyMatchResult(io, { matchId: final.id, winnerId: 'u4', player1Score: 30, player2Score: 22 }, persistence);
    const after = events.filter((e) => e.event === 'tournament:completed').length;

    expect(before).toBe(1);
    expect(after).toBe(1);
  });
});

describe('cancelTournament', () => {
  it('updates status and emits cancellation', async () => {
    const tournament = makeTournament();
    const { persistence, store } = makePersistence(tournament, []);
    const { io, events } = makeIoMock();

    await cancelTournament(io, 'tour-1', persistence);

    expect(store.tournament.status).toBe('cancelled');
    expect(events.some((e) => e.event === 'tournament:cancelled')).toBe(true);
  });
});

describe('bye-walkover edge cases', () => {
  it('handles 5 players: top 3 seeds get byes, only 1 real QF match plays', async () => {
    const tournament = makeTournament();
    const regs = [makeReg('u1'), makeReg('u2'), makeReg('u3'), makeReg('u4'), makeReg('u5')];
    const { persistence, store } = makePersistence(tournament, regs);
    const { io } = makeIoMock();

    await generateBracket(io, 'tour-1', persistence);

    const qf = store.matches.filter((m) => m.round === 1).sort((a, b) => a.match_number - b.match_number);
    const realQfMatches = qf.filter((m) => m.player1_id !== null && m.player2_id !== null);
    const byeQfMatches = qf.filter((m) => m.player1_id === null || m.player2_id === null);

    expect(realQfMatches).toHaveLength(1);
    expect(byeQfMatches).toHaveLength(3);
    // The single real QF should be ready (not auto-completed).
    expect(realQfMatches[0].status).toBe('ready');
    // The bye QFs should all be completed via walkover.
    for (const m of byeQfMatches) {
      expect(m.status).toBe('completed');
    }
  });
});
