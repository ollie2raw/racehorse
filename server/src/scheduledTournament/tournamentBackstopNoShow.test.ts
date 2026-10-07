/**
 * Event backstop, no false no-shows (Phase 1.2 D3): a match the sweep makes
 * ready (or that advancement made ready but nobody dispatched) was never
 * offered to its players, so a missing player there is not a no-show. It is
 * resolved administratively — human vs Fritz: the human advances; two humans:
 * the higher seed — with no no_show_user_id. Only a match that was dispatched
 * (it has a ready_deadline_at, written only by dispatch) and whose join window
 * had expired keeps no-show semantics.
 *
 * Real and faked pieces as in eventBackstop.test.ts.
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
const SOON = new Date(Date.now() + 5 * 60_000).toISOString();
const code = (id: string) => `T4D${id.toUpperCase()}`;

/** A live game for an in-progress match: `seats` in join order with their scores. */
async function liveRoom(matchId: string, seats: Array<{ id: string; score: number }>): Promise<void> {
  const roomCode = code(matchId);
  const room = createReservedRoom(roomCode, { winningScore: 30 });
  room.scheduledTournamentMatchId = matchId;
  room.scheduledTournamentId = T;
  const seatIdOf = (id: string) => (id.startsWith('bot:') ? id : `seat-${id.slice(-2)}`);
  for (const seat of seats) {
    if (seat.id.startsWith('bot:')) {
      seatSyntheticBotInRoom(roomCode, seat.id, 'Fritz');
    } else {
      joinRoom(roomCode, seatIdOf(seat.id));
      setRoomRoster(roomCode, [...getRoomRoster(roomCode), { id: seatIdOf(seat.id), socketId: '', username: 'p', userId: seat.id }]);
    }
  }
  await startGameUnlocked(roomCode, makeIo());
  const live = getRoom(roomCode);
  live.state = {
    ...live.state!,
    players: Object.fromEntries(seats.map((seat) => [seatIdOf(seat.id), { ...live.state!.players[seatIdOf(seat.id)], score: seat.score }])),
  };
}

const inProgress = { status: 'in_progress', started_at: LONG_AGO, ready_at: LONG_AGO, ready_deadline_at: LONG_AGO, player1_joined_at: LONG_AGO };

function store(matches: Row[]): Store {
  return {
    tournament: {
      id: T, scheduled_start: LONG_AGO, registration_open_at: '', registration_close_at: '',
      status: 'in_progress', format: '7-tile', win_target: 30, max_players: 8, winner_id: null, created_at: '',
    },
    matches,
    regs: [U1, U2].map((u, i) => ({ id: `r-${u}`, tournament_id: T, user_id: u, registered_at: '', seed: i + 1, placement: null, status: 'active' })),
  };
}

/** QF1 U1 vs Fritz 7 (U1 ahead, in progress); QF2 Fritz 4 vs 5 done; QF3 `qf3`; QF4 Fritz 2 vs 3 ready; semis and final waiting. */
async function eventWithQf3(qf3: Row): Promise<Store> {
  await liveRoom('qf1', [{ id: bot(7), score: 10 }, { id: U1, score: 25 }]);
  return store([
    matchRow('qf1', 1, 1, code('qf1'), U1, bot(7), inProgress),
    matchRow('qf2', 1, 2, code('qf2'), bot(4), bot(5), { status: 'completed', winner_id: bot(4), completed_at: LONG_AGO }),
    qf3,
    matchRow('qf4', 1, 4, code('qf4'), bot(2), bot(3), { status: 'ready', ready_at: LONG_AGO }),
    matchRow('sf1', 2, 1, code('sf1'), null, bot(4)),
    matchRow('sf2', 2, 2, code('sf2'), null, null),
    matchRow('f', 3, 1, code('f'), null, null),
  ]);
}

const row = (s: Store, id: string) => s.matches.find((m) => m.id === id)!;
const reg = (s: Store, u: string) => s.regs.find((r) => r.user_id === u)!;

beforeEach(() => {
  h.liveSessions.clear();
  vi.mocked(Sentry.captureMessage).mockClear();
  resetAlertThrottleForTests();
  restart();
});
afterEach(() => {
  restart();
});

describe('event backstop: no no-show for a match nobody was offered', () => {
  it('a human who wins round 1 in the sweep is not a no-show in the undispatched semi: they advance', async () => {
    const s = await eventWithQf3(matchRow('qf3', 1, 3, code('qf3'), U2, bot(6), { status: 'ready', ready_at: LONG_AGO, ready_deadline_at: LONG_AGO }));

    await resolveExpiredTournament(makeIo(), T, makePersistence(s));

    expect(row(s, 'qf1')).toMatchObject({ winner_id: U1, status_reason: 'event_backstop_higher_score' });
    expect(row(s, 'sf1').ready_deadline_at).toBeNull(); // never dispatched
    expect(row(s, 'sf1')).toMatchObject({
      player1_id: U1, player2_id: bot(4), winner_id: U1, no_show_user_id: null,
      status_reason: 'event_backstop_undispatched_human_advanced',
    });
    expect(s.matches.filter((m) => m.no_show_user_id === U1)).toHaveLength(0);
  });

  it('human vs Fritz in an undispatched final: the human advances (and is not eliminated)', async () => {
    const s = await eventWithQf3(matchRow('qf3', 1, 3, code('qf3'), U2, bot(6), { status: 'ready', ready_at: LONG_AGO, ready_deadline_at: LONG_AGO }));

    await resolveExpiredTournament(makeIo(), T, makePersistence(s));

    expect(row(s, 'f')).toMatchObject({ player1_id: U1, winner_id: U1, no_show_user_id: null, status_reason: 'event_backstop_undispatched_human_advanced' });
    expect(reg(s, U1)).toMatchObject({ status: 'winner', placement: 1 });
  });

  it('human vs human in an undispatched semi: the higher seed advances administratively, no no-show', async () => {
    await liveRoom('qf1', [{ id: bot(7), score: 10 }, { id: U1, score: 25 }]);
    await liveRoom('qf2', [{ id: bot(5), score: 3 }, { id: U2, score: 20 }]);
    const s = store([
      matchRow('qf1', 1, 1, code('qf1'), U1, bot(7), inProgress),
      matchRow('qf2', 1, 2, code('qf2'), U2, bot(5), inProgress),
      matchRow('qf3', 1, 3, code('qf3'), bot(4), bot(6), { status: 'completed', winner_id: bot(4), completed_at: LONG_AGO }),
      matchRow('qf4', 1, 4, code('qf4'), bot(2), bot(3), { status: 'completed', winner_id: bot(2), completed_at: LONG_AGO }),
      matchRow('sf1', 2, 1, code('sf1'), null, null),
      matchRow('sf2', 2, 2, code('sf2'), bot(4), bot(2), { status: 'ready' }),
      matchRow('f', 3, 1, code('f'), null, null),
    ]);

    await resolveExpiredTournament(makeIo(), T, makePersistence(s));

    expect(row(s, 'sf1')).toMatchObject({
      player1_id: U1, player2_id: U2, winner_id: U1, no_show_user_id: null,
      status_reason: 'event_backstop_undispatched_higher_seed',
    });
    expect(reg(s, U2).status).toBe('eliminated');
  });

  it('Fritz vs Fritz keeps the existing deterministic resolution and records no no-show', async () => {
    const s = await eventWithQf3(matchRow('qf3', 1, 3, code('qf3'), U2, bot(6), { status: 'ready', ready_at: LONG_AGO, ready_deadline_at: LONG_AGO }));

    await resolveExpiredTournament(makeIo(), T, makePersistence(s));

    for (const id of ['qf4', 'sf2']) {
      expect(row(s, id)).toMatchObject({ winner_source: 'game_over', status_reason: 'bot_simulated', no_show_user_id: null });
    }
    expect(row(s, 'qf4').winner_id).toBe(bot(2)); // the first-listed bot, as resolveBotOnlyMatch picks
  });

  it('a match that was dispatched and whose join window expired keeps real no-show semantics', async () => {
    const s = await eventWithQf3(matchRow('qf3', 1, 3, code('qf3'), U2, bot(6), { status: 'ready', ready_at: LONG_AGO, ready_deadline_at: LONG_AGO }));

    await resolveExpiredTournament(makeIo(), T, makePersistence(s));

    expect(row(s, 'qf3')).toMatchObject({
      winner_id: bot(6), winner_source: 'no_show', no_show_user_id: U2, status_reason: 'event_backstop_player1_no_show',
    });
  });

  it('a match dispatched moments ago, whose join window is still open, is not a no-show either', async () => {
    const s = await eventWithQf3(matchRow('qf3', 1, 3, code('qf3'), U2, bot(6), { status: 'ready', ready_at: LONG_AGO, ready_deadline_at: SOON }));

    await resolveExpiredTournament(makeIo(), T, makePersistence(s));

    expect(row(s, 'qf3')).toMatchObject({
      winner_id: U2, no_show_user_id: null, status_reason: 'event_backstop_window_open_human_advanced',
    });
  });

  it('the full bracket completes with placements, and a repeated run changes nothing', async () => {
    const s = await eventWithQf3(matchRow('qf3', 1, 3, code('qf3'), U2, bot(6), { status: 'ready', ready_at: LONG_AGO, ready_deadline_at: LONG_AGO }));

    expect(await resolveExpiredTournament(makeIo(), T, makePersistence(s))).toMatchObject({ kind: 'completed' });
    expect(s.tournament).toMatchObject({ status: 'completed', winner_id: U1 });
    expect(s.matches.every((m) => m.status === 'completed')).toBe(true);
    expect(reg(s, U1).placement).toBe(1);
    expect(reg(s, U2).placement).toEqual(expect.any(Number));

    const finished = structuredClone(s);
    expect(await resolveExpiredTournament(makeIo(), T, makePersistence(s))).toEqual({ kind: 'not_in_progress' });
    expect(s).toEqual(finished);
  });
});
