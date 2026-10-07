/**
 * Two-hour event backstop (Phase 1.1 §4, eventBackstop.ts): an event still
 * in progress past its active window is finished round by round through the
 * normal result path instead of being cancelled — unstarted matches by
 * attendance / no-show, matches in progress by live score then seed, a lost
 * live session labelled and alerted, bot pairs by seed — without dispatching
 * next-round matches, and with placements written when the final completes.
 * Only unrecoverable rows cancel the event (with a loud alert); a transient
 * failure is retried by the next tick.
 *
 * Real: rooms, roster, live-session restore, applyMatchResult. Faked:
 * `supabaseFetch` (in-memory `room_live_sessions`), tournament rows (an
 * EnginePersistence over the in-memory port of `complete_tournament_match`),
 * Sentry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/node';

type Row = Record<string, any>;
const h = vi.hoisted(() => ({ liveSessions: new Map<string, Record<string, unknown>>() }));

vi.mock('@sentry/node', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('../social/activityWriter', () => ({
  writeTournamentActivity: vi.fn().mockResolvedValue(undefined),
  writeMatchActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../supabaseUtils', () => ({
  isSupabaseTimeoutError: () => false,
  supabaseFetch: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (path.startsWith('/rest/v1/room_live_sessions')) {
      if (method === 'POST') {
        for (const row of JSON.parse(init!.body!) as Array<Record<string, unknown>>) {
          h.liveSessions.set(String(row.room_code), structuredClone(row));
        }
        return [];
      }
      const code = decodeURIComponent(/room_code=eq\.([^&]+)/.exec(path)![1]);
      if (method === 'DELETE') {
        h.liveSessions.delete(code);
        return [];
      }
      const row = h.liveSessions.get(code);
      return row ? [structuredClone(row)] : [];
    }
    return [];
  }),
}));

import {
  createReservedRoom,
  getRoom,
  joinRoom,
  peekRoom,
  resetLiveRoomPersistHookForTests,
  resetRoomRuntimeForTests,
  startGameUnlocked,
} from '../rooms';
import { getRoomRoster, initRoomSession, resetRoomSessionStoresForTests, setRoomRoster } from '../multiplayer/roomSession';
import { resetLiveRoomPersistenceForTests } from '../multiplayer/roomLivePersistence';
import { resetTournamentTurnClockForTests } from '../multiplayer/tournamentTurnClock';
import { seatSyntheticBotInRoom } from '../multiplayer/botSeating';
import { resolveExpiredTournament } from './eventBackstop';
import { resetAlertThrottleForTests } from './tournamentAlerts';
import { inMemoryMatchRpcForArrayStore } from './inMemoryMatchRpc.testkit';
import type { EnginePersistence } from './persistenceInterface';
import { restoreOrCreateTournamentRoom } from './tournamentRoomRestore';

const T = '4b000000-0000-4000-8000-000000000001';
const U1 = '4b000000-0000-4000-8000-0000000000a1';
const U2 = '4b000000-0000-4000-8000-0000000000a2';
const bot = (n: number) => `bot:fritz:${T}:${n}`;

function makeIo() {
  return {
    sockets: { sockets: new Map(), adapter: { rooms: new Map() } },
    to: () => ({ emit: vi.fn() }),
    emit: vi.fn(),
  } as any;
}

function initSession() {
  initRoomSession(makeIo(), {
    resolveSocketIdentity: async () => ({ username: 'Player', userId: null }),
    normalizeUsername: (value: unknown) => (typeof value === 'string' ? value : 'Guest'),
    normalizeUserId: (value: unknown) => (typeof value === 'string' ? value : null),
    tryHydrateMatchmakingRoomShell: async () => 'skipped',
    waitUntilMatchmakingRoomSocketsReady: async () => undefined,
    onAfterMatchStarted: async () => undefined,
    notifyRoomPlayersInGame: () => undefined,
    maybeFinalizeTournamentMatch: () => undefined,
    persistRoomMatchLog: async () => undefined,
    onGameOver: () => null,
    finalizeTournamentMatch: () => undefined,
  } as any);
}

/** Everything a process restart loses. */
function restart() {
  resetTournamentTurnClockForTests();
  resetLiveRoomPersistenceForTests();
  resetLiveRoomPersistHookForTests();
  resetRoomRuntimeForTests();
  resetRoomSessionStoresForTests();
  initSession();
}

function matchRow(id: string, round: number, matchNumber: number, roomCode: string, p1: string | null, p2: string | null, partial: Row = {}): Row {
  return {
    id, tournament_id: T, round, match_number: matchNumber, player1_id: p1, player2_id: p2,
    winner_id: null, room_code: roomCode, status: 'waiting', ready_at: null, ready_deadline_at: null,
    started_at: null, completed_at: null, player1_joined_at: null, player2_joined_at: null,
    winner_source: null, status_reason: null, forfeit_user_id: null, no_show_user_id: null,
    bot_tier: null, player1_score: null, player2_score: null, ...partial,
  };
}

type Store = { tournament: Row; matches: Row[]; regs: Row[] };

function makePersistence(store: Store, overrides: Partial<EnginePersistence> = {}): EnginePersistence {
  const rpc = () => inMemoryMatchRpcForArrayStore(store as any);
  return {
    fetchTournamentById: async (id: string) => (id === T ? structuredClone(store.tournament) : null),
    fetchTournamentsByStatus: async () => [structuredClone(store.tournament)],
    fetchMatches: async () => structuredClone(store.matches),
    fetchMatchById: async (id: string) => structuredClone(store.matches.find((m) => m.id === id) ?? null),
    fetchMatchByRoomCode: async (code: string) => structuredClone(store.matches.find((m) => m.room_code === code) ?? null),
    fetchRegistrations: async () => structuredClone(store.regs),
    fetchRegistrationsWithProfile: async () => [],
    updateMatch: async (id: string, patch: Row) => { Object.assign(store.matches.find((m) => m.id === id)!, patch); },
    completeTournamentMatch: (params: any) => rpc().completeTournamentMatch(params),
    promoteTournamentMatch: (...args: any[]) => (rpc().promoteTournamentMatch as any)(...args),
    generateTournamentBracket: async () => { throw new Error('not expected'); },
    updateRegistrationPlacement: async () => {},
    updateTournamentStatus: async (_id: string, status: string, extra: Row = {}) => {
      Object.assign(store.tournament, { status, ...extra });
    },
    createReservedRoom,
    getRoom,
    restoreOrCreateRoom: restoreOrCreateTournamentRoom,
    ...overrides,
  } as unknown as EnginePersistence;
}

const LONG_AGO = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
const code = (id: string) => `T4B${id.toUpperCase()}`;

/**
 * An event 3 h past its start. QF1 U1 vs Fritz 7 is in progress in a live room
 * (scores given); QF2 Fritz 4 vs 5 is done; QF3 U2 vs Fritz 6 is ready but U2
 * never joined; QF4 Fritz 2 vs 3 is still ready; the semis and the final wait.
 */
async function seedStaleEvent(opts: { qf1Scores?: { human: number; fritz: number }; qf1Room?: boolean; qf1SeatUser?: string } = {}) {
  const store: Store = {
    tournament: {
      id: T, scheduled_start: LONG_AGO, registration_open_at: '', registration_close_at: '',
      status: 'in_progress', format: '7-tile', win_target: 30, max_players: 8, winner_id: null, created_at: '',
    },
    matches: [
      matchRow('qf1', 1, 1, code('qf1'), U1, bot(7), { status: 'in_progress', started_at: LONG_AGO, ready_at: LONG_AGO, player1_joined_at: LONG_AGO, bot_tier: 'standard' }),
      matchRow('qf2', 1, 2, code('qf2'), bot(4), bot(5), { status: 'completed', winner_id: bot(4), completed_at: LONG_AGO }),
      matchRow('qf3', 1, 3, code('qf3'), U2, bot(6), { status: 'ready', ready_at: LONG_AGO, ready_deadline_at: LONG_AGO, bot_tier: 'standard' }),
      matchRow('qf4', 1, 4, code('qf4'), bot(2), bot(3), { status: 'ready', ready_at: LONG_AGO }),
      matchRow('sf1', 2, 1, code('sf1'), null, bot(4)),
      matchRow('sf2', 2, 2, code('sf2'), null, null),
      matchRow('f', 3, 1, code('f'), null, null),
    ],
    regs: [U1, U2].map((u, i) => ({ id: `r-${u}`, tournament_id: T, user_id: u, registered_at: '', seed: i + 1, placement: null, status: 'active' })),
  };
  if (opts.qf1Room !== false) {
    const roomCode = code('qf1');
    const room = createReservedRoom(roomCode, { winningScore: 30 });
    room.scheduledTournamentMatchId = 'qf1';
    room.scheduledTournamentId = T;
    seatSyntheticBotInRoom(roomCode, bot(7), 'Fritz');
    joinRoom(roomCode, 'seat-u1');
    setRoomRoster(roomCode, [...getRoomRoster(roomCode), { id: 'seat-u1', socketId: '', username: 'u1', userId: opts.qf1SeatUser ?? U1 }]);
    await startGameUnlocked(roomCode, makeIo());
    const scores = opts.qf1Scores ?? { human: 0, fritz: 0 };
    const live = getRoom(roomCode);
    live.state = {
      ...live.state!,
      players: {
        ...live.state!.players,
        'seat-u1': { ...live.state!.players['seat-u1'], score: scores.human },
        [bot(7)]: { ...live.state!.players[bot(7)], score: scores.fritz },
      },
    };
  }
  return store;
}

const row = (store: Store, id: string) => store.matches.find((m) => m.id === id)!;
const anomalyAlerts = (kind: string) =>
  vi.mocked(Sentry.captureMessage).mock.calls.filter(([message]) => message === `[tournament] ${kind}`);

beforeEach(() => {
  h.liveSessions.clear();
  vi.mocked(Sentry.captureMessage).mockClear();
  resetAlertThrottleForTests();
  restart();
});
afterEach(() => {
  restart();
});

describe('event backstop', () => {
  it('finishes the whole event through the result path: placements written, nothing cancelled', async () => {
    const store = await seedStaleEvent({ qf1Scores: { human: 25, fritz: 10 } });
    const io = makeIo();

    const outcome = await resolveExpiredTournament(io, T, makePersistence(store));

    expect(outcome).toEqual({ kind: 'completed', resolved: 6 });
    expect(store.tournament.status).toBe('completed');
    expect(store.tournament.cancel_reason).toBeUndefined();
    expect(store.matches.every((m) => m.status === 'completed')).toBe(true);
    expect(store.tournament.winner_id).toBe(row(store, 'f').winner_id);
    for (const u of [U1, U2]) expect(store.regs.find((r) => r.user_id === u)?.placement).toEqual(expect.any(Number));
    expect(io.emit).toHaveBeenCalledWith('tournament:completed', expect.objectContaining({ tournamentId: T }));
  });

  it('an in-progress match is decided by its live score; its room is closed', async () => {
    const store = await seedStaleEvent({ qf1Scores: { human: 25, fritz: 10 } });

    await resolveExpiredTournament(makeIo(), T, makePersistence(store));

    expect(row(store, 'qf1')).toMatchObject({
      winner_id: U1, winner_source: 'game_over', status_reason: 'event_backstop_higher_score', player1_score: 25, player2_score: 10,
    });
    expect(getRoom(code('qf1')).abandonedAt).toBeTruthy();
  });

  it('an in-progress tie goes to the higher seed', async () => {
    const store = await seedStaleEvent({ qf1Scores: { human: 12, fritz: 12 } });

    await resolveExpiredTournament(makeIo(), T, makePersistence(store));

    expect(row(store, 'qf1')).toMatchObject({ winner_id: U1, status_reason: 'event_backstop_higher_seed' });
  });

  it('a dispatched match whose join window expired uses attendance; an undispatched later round is never a no-show', async () => {
    const store = await seedStaleEvent({ qf1Scores: { human: 25, fritz: 10 } });

    await resolveExpiredTournament(makeIo(), T, makePersistence(store));

    expect(row(store, 'qf3')).toMatchObject({
      winner_id: bot(6), winner_source: 'no_show', no_show_user_id: U2, status_reason: 'event_backstop_player1_no_show',
    });
    // U1 won QF1 on the clock; the semi was never dispatched, so U1 could not
    // have missed it (Phase 1.2 D3): U1 advances administratively.
    expect(row(store, 'sf1')).toMatchObject({
      player1_id: U1, winner_id: U1, no_show_user_id: null, status_reason: 'event_backstop_undispatched_human_advanced',
    });
    expect(row(store, 'qf4')).toMatchObject({ winner_id: bot(2), status_reason: 'bot_simulated' });
  });

  it('does not dispatch next-round matches while it runs (no rooms, no match_ready)', async () => {
    const store = await seedStaleEvent({ qf1Scores: { human: 25, fritz: 10 } });
    const io = makeIo();
    const toEmits: string[] = [];
    io.to = () => ({ emit: (event: string) => { toEmits.push(event); } });

    await resolveExpiredTournament(io, T, makePersistence(store));

    for (const id of ['sf1', 'sf2', 'f']) expect(peekRoom(code(id))).toBeUndefined();
    expect(toEmits).not.toContain('tournament:match_ready');
    expect(io.emit.mock.calls.map(([event]: [string]) => event)).not.toContain('tournament:match_ready');
  });

  it('a lost live session is decided by seed under its own reason and alerted; the event still completes', async () => {
    const store = await seedStaleEvent({ qf1Room: false });

    const outcome = await resolveExpiredTournament(makeIo(), T, makePersistence(store));

    expect(outcome.kind).toBe('completed');
    expect(row(store, 'qf1')).toMatchObject({
      winner_id: U1, status_reason: 'event_backstop_missing_session_higher_seed', player1_score: 0, player2_score: 0,
    });
    expect(anomalyAlerts('missing_live_session')).toHaveLength(1);
    expect(store.tournament.status).toBe('completed');
  });

  it('unrecoverable rows cancel the event with a reason and a loud alert; earlier results stand', async () => {
    // The live room's human seat belongs to someone else: the room is not this match.
    const store = await seedStaleEvent({ qf1Scores: { human: 25, fritz: 10 }, qf1SeatUser: 'someone-else' });

    const outcome = await resolveExpiredTournament(makeIo(), T, makePersistence(store));

    expect(outcome).toEqual({ kind: 'cancelled_unrecoverable', reason: 'active_window_unrecoverable:tournament_seat_mismatch', resolved: 0 });
    expect(store.tournament).toMatchObject({ status: 'cancelled', cancel_reason: 'active_window_unrecoverable:tournament_seat_mismatch' });
    expect(anomalyAlerts('event_backstop_unrecoverable')).toHaveLength(1);
    expect(row(store, 'qf1').status).toBe('in_progress');
  });

  it('a transient failure is rethrown (not cancelled) and the next tick finishes the event; a later tick is a no-op', async () => {
    const store = await seedStaleEvent({ qf1Scores: { human: 25, fritz: 10 } });
    const base = makePersistence(store);
    let failOnce = true;
    const flaky = makePersistence(store, {
      completeTournamentMatch: async (params: any) => {
        if (failOnce && params.matchId === 'qf3') {
          failOnce = false;
          throw new Error('fetch failed');
        }
        return base.completeTournamentMatch(params);
      },
    } as Partial<EnginePersistence>);

    await expect(resolveExpiredTournament(makeIo(), T, flaky)).rejects.toThrow('fetch failed');
    expect(store.tournament.status).toBe('in_progress');
    expect(row(store, 'qf1').status).toBe('completed');

    expect((await resolveExpiredTournament(makeIo(), T, flaky)).kind).toBe('completed');
    const finished = structuredClone(store);
    expect(await resolveExpiredTournament(makeIo(), T, flaky)).toEqual({ kind: 'not_in_progress' });
    expect(store).toEqual(finished);
  });
});
