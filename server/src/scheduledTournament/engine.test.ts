import { describe, it, expect, vi, beforeEach } from 'vitest';

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
      const readyAt = match.ready_at ?? new Date('2026-05-16T00:00:00Z').toISOString();
      await persistence.updateMatch(matchId, {
        room_code: match.room_code || `R-${matchId}`,
        status: match.status === 'in_progress' ? 'in_progress' : 'ready',
        ready_at: readyAt,
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

import { writeTournamentActivity } from '../social/activityWriter';

import {
  generateBracket,
  applyMatchResult,
  closeRegistrationAndStart,
  cancelTournament,
  reconcileExpiredReadyMatches,
  dispatchScheduledStartMatches,
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
  const sockets: Array<{ id: string; data: { userId?: string }; emit: (e: string, p: unknown) => void }> = [
    'u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8',
  ].map((userId) => ({
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
    fetchTournamentsByStatus: async (statuses) =>
      statuses.includes(store.tournament.status) ? [{ ...store.tournament }] : [],
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
    registration_close_at: new Date('2026-05-14T23:58:00Z').toISOString(),
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
    placement: null,
    status: 'registered',
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('closeRegistrationAndStart', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('cancels the tournament only when zero humans are registered', async () => {
    const tournament = makeTournament();
    const { persistence, store } = makePersistence(tournament, []);
    const { io, events } = makeIoMock();

    const result = await closeRegistrationAndStart(io, 'tour-1', persistence);

    expect(result).toEqual({ started: false, reason: 'not_enough_players' });
    expect(store.tournament.status).toBe('cancelled');
    expect(events.some((e) => e.event === 'tournament:cancelled')).toBe(true);
    expect(store.matches).toHaveLength(0);
  });

  it('starts with one human and fills the remaining slots with Fritz bots', async () => {
    const tournament = makeTournament();
    const regs = [makeReg('u1')];
    const { persistence, store } = makePersistence(tournament, regs);
    const { io, events } = makeIoMock();

    const result = await closeRegistrationAndStart(io, 'tour-1', persistence);

    expect(result).toEqual({ started: true });
    expect(store.tournament.status).toBe('in_progress');
    expect(store.matches).toHaveLength(7); // 4 QF + 2 SF + 1 Final
    expect(events.some((e) => e.event === 'tournament:bracket_generated')).toBe(true);

    const qf = store.matches
      .filter((m) => m.round === 1)
      .sort((a, b) => a.match_number - b.match_number);
    const qfPlayerIds = qf.flatMap((m) => [m.player1_id, m.player2_id]).filter(Boolean) as string[];
    expect(qfPlayerIds.filter((id) => id === 'u1')).toHaveLength(1);
    expect(qfPlayerIds.filter((id) => id.startsWith('bot:fritz:tour-1:'))).toHaveLength(7);
    expect(qf[0].player1_id).toBe('u1');
    expect(qf[0].player2_id).toMatch(/^bot:fritz:tour-1:/);
    expect(qf[0].status).toBe('waiting');
    expect(qf.slice(1).every((m) => m.status === 'waiting')).toBe(true);
    expect(qf.slice(1).every((m) => !m.winner_id)).toBe(true);

    const atStart = await dispatchScheduledStartMatches(
      io,
      'tour-1',
      persistence,
      new Date(tournament.scheduled_start),
    );
    expect(atStart).toBeGreaterThan(0);
    const qfAfterStart = store.matches
      .filter((m) => m.round === 1)
      .sort((a, b) => a.match_number - b.match_number);
    expect(qfAfterStart.slice(1).every((m) => m.status === 'completed')).toBe(true);
    expect(qfAfterStart.slice(1).every((m) => m.status_reason === 'bot_simulated')).toBe(true);
    expect(store.matches.filter((m) => m.player1_id?.startsWith('bot:fritz:') && m.player2_id?.startsWith('bot:fritz:') && m.status === 'in_progress')).toHaveLength(0);
    expect(qf.every((m) => m.bot_tier === 'standard')).toBe(true);
  });

  it('does not no-show humans before scheduled_start even when ready deadline passed', async () => {
    const tournament = makeTournament({
      status: 'in_progress',
      scheduled_start: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    const regs = [makeReg('u1')];
    regs[0].status = 'active';
    regs[0].seed = 1;
    const { persistence, store } = makePersistence(tournament, regs);
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    store.matches.push({
      id: 'm-early-ready',
      tournament_id: 'tour-1',
      round: 1,
      match_number: 1,
      player1_id: 'u1',
      player2_id: 'bot:fritz:tour-1:1',
      winner_id: null,
      room_code: 'REARLY',
      status: 'ready',
      ready_at: expiredAt,
      ready_deadline_at: expiredAt,
      started_at: null,
      completed_at: null,
      player1_joined_at: null,
      player2_joined_at: null,
      winner_source: null,
      status_reason: null,
      forfeit_user_id: null,
      no_show_user_id: null,
      bot_tier: 'standard',
      player1_score: null,
      player2_score: null,
    });
    const { io } = makeIoMock();

    const resolved = await reconcileExpiredReadyMatches(io, new Date(), persistence);

    expect(resolved).toBe(0);
    expect(store.matches[0].status).toBe('ready');
    expect(store.matches[0].winner_id).toBeNull();
  });

  it('dispatches human quarterfinals at scheduled_start without advancing before then', async () => {
    const tournament = makeTournament({
      status: 'in_progress',
      scheduled_start: new Date('2026-05-15T00:00:00Z').toISOString(),
    });
    const regs = [makeReg('u1'), makeReg('u2')];
    const { persistence, store } = makePersistence(tournament, regs);
    const { io } = makeIoMock();

    await closeRegistrationAndStart(io, 'tour-1', persistence);
    const humanQf = store.matches.find(
      (m) => m.round === 1 && (m.player1_id === 'u1' || m.player2_id === 'u1'),
    );
    expect(humanQf?.status).toBe('waiting');
    expect(humanQf?.room_code).toBeFalsy();

    const beforeStart = await dispatchScheduledStartMatches(
      io,
      'tour-1',
      persistence,
      new Date('2026-05-14T23:59:00Z'),
    );
    expect(beforeStart).toBe(0);
    expect(store.matches.find((m) => m.id === humanQf?.id)?.status).toBe('waiting');

    const atStart = await dispatchScheduledStartMatches(
      io,
      'tour-1',
      persistence,
      new Date('2026-05-15T00:00:01Z'),
    );
    expect(atStart).toBeGreaterThan(0);
    expect(store.matches.find((m) => m.id === humanQf?.id)?.status).toBe('ready');
    expect(store.matches.find((m) => m.id === humanQf?.id)?.room_code).toBeTruthy();
  });

  it('keeps human-vs-bot semifinal and final matches playable instead of auto-simulating them', async () => {
    const tournament = makeTournament({
      status: 'in_progress',
      scheduled_start: new Date('2026-05-15T00:00:00Z').toISOString(),
    });
    const regs = [makeReg('u1')];
    const { persistence, store } = makePersistence(tournament, regs);
    const { io } = makeIoMock();

    await closeRegistrationAndStart(io, 'tour-1', persistence);
    await dispatchScheduledStartMatches(io, 'tour-1', persistence, new Date('2026-05-15T00:00:01Z'));

    const qf = store.matches.find(
      (m) => m.round === 1 && (m.player1_id === 'u1' || m.player2_id === 'u1'),
    );
    expect(qf?.status).toBe('ready');
    await applyMatchResult(io, {
      matchId: qf!.id,
      winnerId: 'u1',
      player1Score: qf!.player1_id === 'u1' ? 30 : 18,
      player2Score: qf!.player2_id === 'u1' ? 30 : 18,
    }, persistence);

    const sf = store.matches.find(
      (m) => m.round === 2 && (m.player1_id === 'u1' || m.player2_id === 'u1'),
    );
    expect(sf).toBeDefined();
    expect(sf?.status).toBe('ready');
    expect(sf?.winner_id).toBeNull();
    expect([sf?.player1_id, sf?.player2_id].some((id) => id?.startsWith('bot:fritz:'))).toBe(true);

    await applyMatchResult(io, {
      matchId: sf!.id,
      winnerId: 'u1',
      player1Score: sf!.player1_id === 'u1' ? 30 : 20,
      player2Score: sf!.player2_id === 'u1' ? 30 : 20,
    }, persistence);

    const final = store.matches.find((m) => m.round === 3);
    expect(final).toBeDefined();
    expect(final?.winner_id).toBeNull();
    expect([final?.player1_id, final?.player2_id].includes('u1')).toBe(true);
    expect(final?.status).not.toBe('completed');
    // Other semifinal may still be open, so the final can stay waiting for the second slot.
    expect(['waiting', 'ready']).toContain(final?.status);
  });

  it('does not leave bot-vs-bot matches stuck in_progress in a one-human bracket', async () => {
    const tournament = makeTournament();
    const regs = [makeReg('u1')];
    const { persistence, store } = makePersistence(tournament, regs);
    const { io } = makeIoMock();

    await closeRegistrationAndStart(io, 'tour-1', persistence);

    const botOnlyMatches = store.matches.filter(
      (m) => m.player1_id?.startsWith('bot:fritz:') && m.player2_id?.startsWith('bot:fritz:'),
    );
    expect(botOnlyMatches.length).toBeGreaterThan(0);
    expect(botOnlyMatches.every((m) => m.status === 'waiting')).toBe(true);

    await dispatchScheduledStartMatches(io, 'tour-1', persistence, new Date(tournament.scheduled_start));

    const botQfsAfterStart = store.matches.filter(
      (m) =>
        m.round === 1 &&
        m.player1_id?.startsWith('bot:fritz:') &&
        m.player2_id?.startsWith('bot:fritz:'),
    );
    expect(botQfsAfterStart.every((m) => m.status === 'completed')).toBe(true);
    expect(botQfsAfterStart.every((m) => m.winner_id?.startsWith('bot:fritz:'))).toBe(true);
  });

  it('keeps bot quarterfinals waiting during bracket lobby before scheduled_start', async () => {
    const tournament = makeTournament({
      scheduled_start: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
    const regs = [makeReg('u1')];
    const { persistence, store } = makePersistence(tournament, regs);
    const { io } = makeIoMock();

    await closeRegistrationAndStart(io, 'tour-1', persistence);

    const botQfs = store.matches.filter(
      (m) =>
        m.round === 1 &&
        m.player1_id?.startsWith('bot:fritz:') &&
        m.player2_id?.startsWith('bot:fritz:'),
    );
    expect(botQfs.length).toBeGreaterThan(0);
    expect(botQfs.every((m) => m.status === 'waiting')).toBe(true);
    expect(store.matches.filter((m) => m.round === 2).every((m) => m.status !== 'completed')).toBe(true);
  });

  it('does not complete semifinal bot-only matches before quarterfinals finish', async () => {
    const tournament = makeTournament({
      status: 'in_progress',
      scheduled_start: new Date('2026-05-15T00:00:00Z').toISOString(),
    });
    const regs = [makeReg('u1')];
    const { persistence, store } = makePersistence(tournament, regs);
    const { io } = makeIoMock();

    await closeRegistrationAndStart(io, 'tour-1', persistence);
    await dispatchScheduledStartMatches(io, 'tour-1', persistence, new Date('2026-05-15T00:00:01Z'));

    const humanQf = store.matches.find(
      (m) => m.round === 1 && (m.player1_id === 'u1' || m.player2_id === 'u1'),
    );
    expect(humanQf?.status).toBe('ready');

    const sfMatches = store.matches.filter((m) => m.round === 2);
    expect(sfMatches.every((m) => m.status !== 'completed')).toBe(true);
  });
});

describe('generateBracket idempotency', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('does not duplicate match rows when generateBracket runs twice', async () => {
    const tournament = makeTournament();
    const regs = ['u1', 'u2', 'u3', 'u4'].map(makeReg);
    const { persistence, store } = makePersistence(tournament, regs);
    const { io } = makeIoMock();

    await generateBracket(io, 'tour-1', persistence);
    const countAfterFirst = store.matches.length;
    expect(countAfterFirst).toBe(7);

    await generateBracket(io, 'tour-1', persistence);
    expect(store.matches).toHaveLength(countAfterFirst);
  });
});

describe('full bracket lifecycle (8 players)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('drives 8 players through QF → SF → Final, one tournament:completed fires', async () => {
    // Ratings: u8=1800 ... u1=1100, so u8 is seed 1.
    const tournament = makeTournament();
    const regs = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8'].map(makeReg);
    const { persistence, store } = makePersistence(tournament, regs);
    const { io, events } = makeIoMock();

    await generateBracket(io, 'tour-1', persistence);

    // 4 QF + 2 SF + 1 Final = 7 rows.
    expect(store.matches.filter((m) => m.round === 1)).toHaveLength(4);
    expect(store.matches.filter((m) => m.round === 2)).toHaveLength(2);
    expect(store.matches.filter((m) => m.round === 3)).toHaveLength(1);

    const qf = store.matches
      .filter((m) => m.round === 1)
      .sort((a, b) => a.match_number - b.match_number);
    expect(qf[0].player1_id).toBe('u8');
    expect(qf[0].player2_id).toBe('u1');
    expect(qf[1].player1_id).toBe('u5');
    expect(qf[1].player2_id).toBe('u4');
    expect(qf[2].player1_id).toBe('u6');
    expect(qf[2].player2_id).toBe('u3');
    expect(qf[3].player1_id).toBe('u7');
    expect(qf[3].player2_id).toBe('u2');
    for (const m of qf) {
      expect(m.status).toBe('waiting');
      expect(m.winner_id).toBeNull();
    }

    await dispatchScheduledStartMatches(io, 'tour-1', persistence, new Date('2026-05-15T00:00:01Z'));
    for (const m of qf) {
      expect(m.status).toBe('ready');
    }

    await applyMatchResult(io, { matchId: qf[0].id, winnerId: 'u8', player1Score: 30, player2Score: 20 }, persistence);
    await applyMatchResult(io, { matchId: qf[1].id, winnerId: 'u5', player1Score: 30, player2Score: 18 }, persistence);
    await applyMatchResult(io, { matchId: qf[2].id, winnerId: 'u6', player1Score: 30, player2Score: 22 }, persistence);
    await applyMatchResult(io, { matchId: qf[3].id, winnerId: 'u7', player1Score: 30, player2Score: 16 }, persistence);

    const sf = store.matches
      .filter((m) => m.round === 2)
      .sort((a, b) => a.match_number - b.match_number);
    expect(sf[0].player1_id).toBe('u8');
    expect(sf[0].player2_id).toBe('u5');
    expect(sf[0].status).toBe('ready');
    expect(sf[1].player1_id).toBe('u6');
    expect(sf[1].player2_id).toBe('u7');
    expect(sf[1].status).toBe('ready');
    expect(events.some((e) => e.event === 'tournament:round_completed' && (e.payload as any).round === 1)).toBe(true);

    const final = store.matches.find((m) => m.round === 3)!;
    expect(final.player1_id).toBeNull();
    expect(final.player2_id).toBeNull();
    expect(final.status).toBe('waiting');

    await applyMatchResult(io, {
      matchId: sf[0].id, winnerId: 'u8', player1Score: 30, player2Score: 25,
    }, persistence);

    const finalAfterSf1 = store.matches.find((m) => m.round === 3)!;
    expect(finalAfterSf1.player1_id).toBe('u8');
    expect(finalAfterSf1.status).toBe('waiting'); // SF2 still pending

    expect(store.regs.find((r) => r.user_id === 'u5')?.status).toBe('eliminated');

    await applyMatchResult(io, {
      matchId: sf[1].id, winnerId: 'u6', player1Score: 30, player2Score: 18,
    }, persistence);

    const finalReady = store.matches.find((m) => m.round === 3)!;
    expect(finalReady.player1_id).toBe('u8');
    expect(finalReady.player2_id).toBe('u6');
    expect(finalReady.status).toBe('ready');
    expect(finalReady.ready_at).toBeTruthy();
    expect(store.regs.find((r) => r.user_id === 'u7')?.status).toBe('eliminated');
    expect(
      events.filter(
        (e) =>
          e.event === 'tournament:match_completed' &&
          (e.payload as { matchId?: string }).matchId === sf[1].id &&
          (e.target === 'u6' || e.target === 'u7'),
      ),
    ).toHaveLength(2);

    await applyMatchResult(io, {
      matchId: finalReady.id, winnerId: 'u8', player1Score: 30, player2Score: 22,
    }, persistence);

    const finalDone = store.matches.find((m) => m.round === 3)!;
    expect(finalDone.status).toBe('completed');
    expect(finalDone.winner_id).toBe('u8');
    expect(store.tournament.status).toBe('completed');
    expect(store.tournament.winner_id).toBe('u8');
    expect(store.regs.find((r) => r.user_id === 'u8')?.status).toBe('winner');
    expect(store.regs.find((r) => r.user_id === 'u6')?.status).toBe('eliminated');
    expect(store.regs.find((r) => r.user_id === 'u8')?.placement).toBe(1);
    expect(store.regs.find((r) => r.user_id === 'u6')?.placement).toBe(2);
    expect(store.regs.find((r) => r.user_id === 'u5')?.placement).toBe(3);
    expect(store.regs.find((r) => r.user_id === 'u7')?.placement).toBe(3);
    expect(store.regs.find((r) => r.user_id === 'u1')?.placement).toBe(5);
    expect(writeTournamentActivity).toHaveBeenCalledTimes(8);

    const completed = events.filter((e) => e.event === 'tournament:completed');
    expect(completed).toHaveLength(1);
    expect(completed[0].payload).toEqual({ tournamentId: 'tour-1', winnerId: 'u8' });
    expect(events.some((e) => e.event === 'tournament:round_completed' && (e.payload as any).round === 2)).toBe(true);
  });

  it('applyMatchResult is idempotent — replay does not re-fire completed', async () => {
    const tournament = makeTournament();
    const regs = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8'].map(makeReg);
    const { persistence, store } = makePersistence(tournament, regs);
    const { io, events } = makeIoMock();

    await generateBracket(io, 'tour-1', persistence);

    const qf = store.matches.filter((m) => m.round === 1).sort((a, b) => a.match_number - b.match_number);
    await applyMatchResult(io, { matchId: qf[0].id, winnerId: 'u8', player1Score: 30, player2Score: 20 }, persistence);
    await applyMatchResult(io, { matchId: qf[1].id, winnerId: 'u5', player1Score: 30, player2Score: 18 }, persistence);
    await applyMatchResult(io, { matchId: qf[2].id, winnerId: 'u6', player1Score: 30, player2Score: 22 }, persistence);
    await applyMatchResult(io, { matchId: qf[3].id, winnerId: 'u7', player1Score: 30, player2Score: 16 }, persistence);
    const sf = store.matches.filter((m) => m.round === 2).sort((a, b) => a.match_number - b.match_number);
    await applyMatchResult(io, { matchId: sf[0].id, winnerId: 'u8', player1Score: 30, player2Score: 25 }, persistence);
    await applyMatchResult(io, { matchId: sf[1].id, winnerId: 'u6', player1Score: 30, player2Score: 18 }, persistence);
    const final = store.matches.find((m) => m.round === 3)!;
    await applyMatchResult(io, { matchId: final.id, winnerId: 'u8', player1Score: 30, player2Score: 22 }, persistence);

    const before = events.filter((e) => e.event === 'tournament:completed').length;
    // Re-apply the final result — should be a no-op.
    await applyMatchResult(io, { matchId: final.id, winnerId: 'u8', player1Score: 30, player2Score: 22 }, persistence);
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

describe('bot tournament results', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('does not write placement or activity rows for Fritz bot ids', async () => {
    const tournament = makeTournament({ status: 'in_progress' });
    const regs = [makeReg('u1')];
    regs[0].status = 'active';
    const { persistence, store } = makePersistence(tournament, regs);
    const { io } = makeIoMock();
    store.matches.push({
      id: 'm-final',
      tournament_id: 'tour-1',
      round: 3,
      match_number: 1,
      player1_id: 'u1',
      player2_id: 'bot:fritz:tour-1:1',
      winner_id: null,
      room_code: 'RF',
      status: 'in_progress',
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
      bot_tier: 'master',
      player1_score: null,
      player2_score: null,
    });

    await applyMatchResult(io, {
      matchId: 'm-final',
      winnerId: 'u1',
      player1Score: 30,
      player2Score: 18,
    }, persistence);

    expect(store.regs).toHaveLength(1);
    expect(store.regs[0].placement).toBe(1);
    expect(writeTournamentActivity).toHaveBeenCalledTimes(1);
    expect(writeTournamentActivity).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1' }),
    );
  });
});

describe('ready-match reconciliation', () => {
  it('advances the joined player when the opponent no-shows', async () => {
    const tournament = makeTournament({ status: 'in_progress' });
    const regs = [makeReg('u1'), makeReg('u2'), makeReg('u3'), makeReg('u4')];
    regs[0].status = 'active'; regs[0].seed = 4;
    regs[1].status = 'active'; regs[1].seed = 3;
    regs[2].status = 'active'; regs[2].seed = 2;
    regs[3].status = 'active'; regs[3].seed = 1;
    const { persistence, store } = makePersistence(tournament, regs);
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    store.matches.push(
      {
        id: 'm-1',
        tournament_id: 'tour-1',
        round: 1,
        match_number: 1,
        player1_id: 'u4',
        player2_id: 'u1',
        winner_id: null,
        room_code: 'R1',
        status: 'ready',
        ready_at: expiredAt,
        ready_deadline_at: expiredAt,
        started_at: null,
        completed_at: null,
        player1_joined_at: expiredAt,
        player2_joined_at: null,
        winner_source: null,
        status_reason: null,
        forfeit_user_id: null,
        no_show_user_id: null,
        bot_tier: null,
        player1_score: null,
        player2_score: null,
      },
      {
        id: 'm-2',
        tournament_id: 'tour-1',
        round: 2,
        match_number: 1,
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
      },
    );
    (persistence.getRoom as any).mockReturnValue({ code: 'R1', players: [], state: null });
    const { io } = makeIoMock();

    const resolved = await reconcileExpiredReadyMatches(io, new Date(), persistence);

    expect(resolved).toBe(1);
    expect(store.matches[0].status).toBe('completed');
    expect(store.matches[0].winner_id).toBe('u4');
    expect(store.matches[0].winner_source).toBe('no_show');
    expect(store.matches[0].no_show_user_id).toBe('u1');
    expect(store.matches[0].status_reason).toBe('player2_no_show');
    expect(store.regs.find((reg) => reg.user_id === 'u1')?.status).toBe('eliminated');
    expect(store.matches[1].player1_id).toBe('u4');
  });

  it('advances the higher seed when both players no-show', async () => {
    const tournament = makeTournament({ status: 'in_progress' });
    const regs = [makeReg('u1'), makeReg('u2'), makeReg('u3'), makeReg('u4')];
    regs[0].status = 'active'; regs[0].seed = 4;
    regs[1].status = 'active'; regs[1].seed = 3;
    regs[2].status = 'active'; regs[2].seed = 2;
    regs[3].status = 'active'; regs[3].seed = 1;
    const { persistence, store } = makePersistence(tournament, regs);
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    store.matches.push({
      id: 'm-1',
      tournament_id: 'tour-1',
      round: 1,
      match_number: 1,
      player1_id: 'u4',
      player2_id: 'u1',
      winner_id: null,
      room_code: 'R1',
      status: 'ready',
      ready_at: expiredAt,
      ready_deadline_at: expiredAt,
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
    });
    (persistence.getRoom as any).mockReturnValue({ code: 'R1', players: [], state: null });
    const { io } = makeIoMock();

    const resolved = await reconcileExpiredReadyMatches(io, new Date(), persistence);

    expect(resolved).toBe(1);
    expect(store.matches[0].winner_id).toBe('u4');
    expect(store.matches[0].winner_source).toBe('no_show');
    expect(store.matches[0].no_show_user_id).toBeNull();
    expect(store.matches[0].status_reason).toBe('double_no_show_higher_seed_advanced');
  });

  it('advances the human by default when neither side joins a human-vs-bot match', async () => {
    const tournament = makeTournament({ status: 'in_progress' });
    const regs = [makeReg('u1')];
    regs[0].status = 'active';
    regs[0].seed = 1;
    const { persistence, store } = makePersistence(tournament, regs);
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    store.matches.push({
      id: 'm-1',
      tournament_id: 'tour-1',
      round: 1,
      match_number: 1,
      player1_id: 'u1',
      player2_id: 'bot:fritz:tour-1:1',
      winner_id: null,
      room_code: 'R1',
      status: 'ready',
      ready_at: expiredAt,
      ready_deadline_at: expiredAt,
      started_at: null,
      completed_at: null,
      player1_joined_at: null,
      player2_joined_at: null,
      winner_source: null,
      status_reason: null,
      forfeit_user_id: null,
      no_show_user_id: null,
      bot_tier: 'standard',
      player1_score: null,
      player2_score: null,
    });
    (persistence.getRoom as any).mockReturnValue({ code: 'R1', players: [], state: null });
    const { io } = makeIoMock();

    const resolved = await reconcileExpiredReadyMatches(io, new Date(), persistence);

    expect(resolved).toBe(1);
    expect(store.matches[0].status).toBe('completed');
    expect(store.matches[0].winner_id).toBe('u1');
    expect(store.matches[0].winner_source).toBe('no_show');
    expect(store.matches[0].no_show_user_id).toBeNull();
  });

  it('extends the deadline instead of no-showing a human when the ready room is missing', async () => {
    const tournament = makeTournament({ status: 'in_progress' });
    const regs = [makeReg('u1'), makeReg('u2')];
    regs[0].status = 'active'; regs[0].seed = 1;
    regs[1].status = 'active'; regs[1].seed = 2;
    const { persistence, store } = makePersistence(tournament, regs);
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    store.matches.push({
      id: 'm-missing-room',
      tournament_id: 'tour-1',
      round: 1,
      match_number: 1,
      player1_id: 'u1',
      player2_id: 'u2',
      winner_id: null,
      room_code: 'RMISS',
      status: 'ready',
      ready_at: expiredAt,
      ready_deadline_at: expiredAt,
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
    });
    const { io } = makeIoMock();

    const resolved = await reconcileExpiredReadyMatches(io, new Date(), persistence);

    expect(resolved).toBe(0);
    expect(store.matches[0].status).toBe('ready');
    expect(store.matches[0].winner_id).toBeNull();
    expect(store.matches[0].status_reason).toBe('room_rehydrated_deadline_extended');
    expect(Date.parse(store.matches[0].ready_deadline_at!)).toBeGreaterThan(Date.now());
  });
});

/**
 * The scheduler tick fetched in-progress tournaments and then called
 * reconcileExpiredReadyMatches, which fetched exactly the same set again —
 * 2,880 duplicate queries a day on a 30-second tick, whether or not anyone was
 * playing.
 */
describe('reconcileExpiredReadyMatches — reusing the caller\'s read', () => {
  it('does not re-query when the caller already has the tournaments', async () => {
    const fetchTournamentsByStatus = vi.fn(async () => []);
    const { persistence } = makePersistence(makeTournament({ status: 'in_progress' }), []);
    const { io } = makeIoMock();

    await reconcileExpiredReadyMatches(io, new Date(), { ...persistence, fetchTournamentsByStatus }, []);

    expect(fetchTournamentsByStatus).not.toHaveBeenCalled();
  });

  it('still fetches for a caller that passes nothing, so standalone use is unchanged', async () => {
    const fetchTournamentsByStatus = vi.fn(async () => []);
    const { persistence } = makePersistence(makeTournament({ status: 'in_progress' }), []);
    const { io } = makeIoMock();

    await reconcileExpiredReadyMatches(io, new Date(), { ...persistence, fetchTournamentsByStatus });

    expect(fetchTournamentsByStatus).toHaveBeenCalledWith(['in_progress']);
  });
});
