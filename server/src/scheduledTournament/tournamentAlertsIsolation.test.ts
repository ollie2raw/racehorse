/**
 * Sentry rate limiting for tournament step failures and live-session overwrite
 * refusals, and failure isolation in start-time dispatch, the scheduler tick,
 * and the per-tournament loops of boot recovery and the no-show reconciler.
 *
 * Faked: Sentry, the logger (to count logged failures), `supabaseFetch` (an
 * in-memory `room_live_sessions` table plus the scheduler's tournament reads),
 * and tournament rows (an EnginePersistence passed in, completion through the
 * in-memory port of `complete_tournament_match`). `./engine` is the real module;
 * the scheduler-tick test overrides two of its functions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const h = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  loggedErrors: [] as Array<Record<string, unknown>>,
  liveSessions: new Map<string, Record<string, unknown>>(),
  schedulerTournaments: [] as Array<Record<string, unknown>>,
  dispatchStartOverride: null as null | ((...args: any[]) => Promise<number>),
  reconcileOverride: null as null | ((...args: any[]) => Promise<number>),
}));

vi.mock('@sentry/node', () => ({ captureMessage: h.captureMessage, captureException: vi.fn() }));
vi.mock('../logger', () => ({
  childLogger: (context: string) => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: (obj: unknown, msg?: string) => {
      h.loggedErrors.push({ context, msg, ...(typeof obj === 'object' && obj ? obj : {}) });
    },
  }),
}));
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
    // The scheduler tick's in-progress read; its lifecycle read gets [].
    if (path.startsWith('/rest/v1/scheduled_tournaments') && path.includes('in_progress')) {
      return structuredClone(h.schedulerTournaments);
    }
    return [];
  }),
}));
vi.mock('./engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./engine')>();
  return {
    ...actual,
    dispatchScheduledStartMatches: (...args: Parameters<typeof actual.dispatchScheduledStartMatches>) =>
      h.dispatchStartOverride ? h.dispatchStartOverride(...args) : actual.dispatchScheduledStartMatches(...args),
    reconcileExpiredReadyMatches: (...args: Parameters<typeof actual.reconcileExpiredReadyMatches>) =>
      h.reconcileOverride ? h.reconcileOverride(...args) : actual.reconcileExpiredReadyMatches(...args),
  };
});

import {
  createReservedRoom,
  deleteRoom,
  getRoom,
  joinRoom,
  resetLiveRoomPersistHookForTests,
  resetRoomRuntimeForTests,
  startGameUnlocked,
} from '../rooms';
import { initRoomSession, resetRoomSessionStoresForTests, setRoomRoster } from '../multiplayer/roomSession';
import {
  persistLiveRoomSessionNow,
  resetLiveRoomPersistenceForTests,
} from '../multiplayer/roomLivePersistence';
import { dispatchScheduledStartMatches, reconcileExpiredReadyMatches } from './engine';
import { inMemoryMatchRpcForArrayStore } from './inMemoryMatchRpc.testkit';
import type { EnginePersistence } from './persistenceInterface';
import { recoverTournamentMatches } from './recovery';
import { startTournamentScheduler, stopTournamentScheduler } from './scheduler';
import {
  ALERT_RESEND_INTERVAL_MS,
  alertTournamentMatchStepFailed,
  clearTournamentMatchStepAlert,
  resetAlertThrottleForTests,
} from './tournamentAlerts';

const TA = '5d000000-0000-4000-8000-00000000000a';
const TB = '5d000000-0000-4000-8000-00000000000b';
const U = ['a1', 'a2', 'a3', 'a4'].map((s) => `5d000000-0000-4000-8000-0000000000${s}`);

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

function tournament(id: string): Row {
  const nowMs = Date.now();
  return {
    id,
    scheduled_start: new Date(nowMs - 10 * 60_000).toISOString(),
    registration_open_at: new Date(nowMs - 40 * 60_000).toISOString(),
    registration_close_at: new Date(nowMs - 12 * 60_000).toISOString(),
    status: 'in_progress', format: '7-tile', win_target: 30, max_players: 8, winner_id: null,
    created_at: new Date(nowMs - 86_400_000).toISOString(),
  };
}

function matchRow(id: string, tournamentId: string, matchNumber: number, roomCode: string, partial: Row = {}): Row {
  return {
    id, tournament_id: tournamentId, round: 1, match_number: matchNumber,
    player1_id: U[(matchNumber - 1) * 2 % 4], player2_id: U[((matchNumber - 1) * 2 + 1) % 4],
    winner_id: null, room_code: roomCode, status: 'waiting', ready_at: null, ready_deadline_at: null,
    started_at: null, completed_at: null, player1_joined_at: null, player2_joined_at: null,
    winner_source: null, status_reason: null, forfeit_user_id: null, no_show_user_id: null,
    bot_tier: null, player1_score: null, player2_score: null, ...partial,
  };
}

/** An EnginePersistence over in-memory rows, with real rooms; `fail` hooks inject errors. */
function makePersistence(store: { tournaments: Row[]; matches: Row[] }, fail: {
  fetchMatchesFor?: string;
  restoreRoomCode?: string;
} = {}): EnginePersistence {
  const rpc = (tournamentId: string) =>
    inMemoryMatchRpcForArrayStore({
      tournament: store.tournaments.find((t) => t.id === tournamentId) as any,
      matches: store.matches as any,
      regs: U.map((u, i) => ({ id: `r${i}`, tournament_id: tournamentId, user_id: u, registered_at: '', seed: i + 1, placement: null, status: 'active' })) as any,
    });
  const tournamentOfMatch = (matchId: string) => store.matches.find((m) => m.id === matchId)!.tournament_id;
  return {
    fetchTournamentById: async (id: string) => structuredClone(store.tournaments.find((t) => t.id === id) ?? null),
    fetchTournamentsByStatus: async (statuses: string[]) =>
      structuredClone(store.tournaments.filter((t) => statuses.includes(t.status))),
    fetchMatches: async (tournamentId: string) => {
      if (tournamentId === fail.fetchMatchesFor) throw new Error('matches_read_failed');
      return structuredClone(store.matches.filter((m) => m.tournament_id === tournamentId));
    },
    fetchMatchById: async (id: string) => structuredClone(store.matches.find((m) => m.id === id) ?? null),
    fetchMatchByRoomCode: async (code: string) => structuredClone(store.matches.find((m) => m.room_code === code) ?? null),
    fetchRegistrations: async () => [],
    fetchRegistrationsWithProfile: async () => [],
    updateMatch: async (id: string, patch: Row) => { Object.assign(store.matches.find((m) => m.id === id)!, patch); },
    completeTournamentMatch: (params: any) => rpc(tournamentOfMatch(params.matchId)).completeTournamentMatch(params),
    promoteTournamentMatch: (matchId: string, ...rest: any[]) =>
      (rpc(tournamentOfMatch(matchId)).promoteTournamentMatch as any)(matchId, ...rest),
    generateTournamentBracket: async () => { throw new Error('not expected'); },
    updateRegistrationPlacement: async () => {},
    updateTournamentStatus: async () => {},
    createReservedRoom,
    getRoom,
    restoreOrCreateRoom: async (code: string, _matchId: string, config: Row) => {
      if (code === fail.restoreRoomCode) throw new Error('room_persistence_unavailable');
      return createReservedRoom(code, config);
    },
  } as unknown as EnginePersistence;
}

const alertsTagged = (tag: string) =>
  h.captureMessage.mock.calls.filter(([, ctx]) => ctx?.tags?.tournament_alert === tag);

beforeEach(() => {
  h.captureMessage.mockClear();
  h.loggedErrors.length = 0;
  h.liveSessions.clear();
  h.schedulerTournaments = [];
  h.dispatchStartOverride = null;
  h.reconcileOverride = null;
  resetAlertThrottleForTests();
  resetLiveRoomPersistenceForTests();
  resetLiveRoomPersistHookForTests();
  resetRoomRuntimeForTests();
  resetRoomSessionStoresForTests();
  initSession();
});
afterEach(() => {
  vi.useRealTimers();
  stopTournamentScheduler();
});

describe('Sentry rate limit for tournament step failures', () => {
  const match = { id: 'm-rate', tournament_id: TA, room_code: 'TROOM1' };

  it('first failure is sent; repeats within 10 minutes are logged but not sent; sent again after', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T12:00:00Z'));

    alertTournamentMatchStepFailed('reconcile', match, new Error('boom'));
    vi.setSystemTime(new Date('2026-10-07T12:00:30Z'));
    alertTournamentMatchStepFailed('reconcile', match, new Error('boom'));
    vi.setSystemTime(new Date('2026-10-07T12:09:59Z'));
    alertTournamentMatchStepFailed('reconcile', match, new Error('boom'));
    expect(alertsTagged('reconcile_failed')).toHaveLength(1);
    expect(h.loggedErrors).toHaveLength(3);

    vi.setSystemTime(new Date(Date.parse('2026-10-07T12:00:00Z') + ALERT_RESEND_INTERVAL_MS));
    alertTournamentMatchStepFailed('reconcile', match, new Error('boom'));
    expect(alertsTagged('reconcile_failed')).toHaveLength(2);
    expect(h.loggedErrors).toHaveLength(4);
  });

  it('keys are per (step, match): another step or match is not suppressed', () => {
    alertTournamentMatchStepFailed('reconcile', match, new Error('boom'));
    alertTournamentMatchStepFailed('recovery', match, new Error('boom'));
    alertTournamentMatchStepFailed('reconcile', { ...match, id: 'm-other' }, new Error('boom'));

    expect(h.captureMessage).toHaveBeenCalledTimes(3);
  });

  it('after the step succeeds, the next failure is sent immediately', () => {
    alertTournamentMatchStepFailed('start_dispatch', match, new Error('boom'));
    alertTournamentMatchStepFailed('start_dispatch', match, new Error('boom'));
    expect(alertsTagged('start_dispatch_failed')).toHaveLength(1);

    clearTournamentMatchStepAlert('start_dispatch', match.id);
    alertTournamentMatchStepFailed('start_dispatch', match, new Error('boom'));

    expect(alertsTagged('start_dispatch_failed')).toHaveLength(2);
  });
});

describe('live-session overwrite refusals go to Sentry, rate limited per room code', () => {
  it('a refused save is reported once per 10 minutes for that room code', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T12:00:00Z'));
    const code = 'T5D0001R1M1';
    // A tournament game in progress, stored.
    const original = createReservedRoom(code, { winningScore: 30 });
    original.scheduledTournamentMatchId = 'm-orig';
    original.scheduledTournamentId = TA;
    joinRoom(code, 'seat-1');
    joinRoom(code, 'seat-2');
    const roster = [
      { seatId: 'seat-1', userId: U[0], username: 'a' },
      { seatId: 'seat-2', userId: U[1], username: 'b' },
    ];
    setRoomRoster(code, roster.map((r) => ({ id: r.seatId, socketId: '', username: r.username, userId: r.userId })));
    await startGameUnlocked(code, makeIo());
    expect(await persistLiveRoomSessionNow(original, roster)).toBe(true);
    expect(h.liveSessions.get(code)).toMatchObject({ match_id: original.matchId, status: 'playing' });

    // A different match's room for the same code tries to save over it.
    deleteRoom(code);
    const intruder = createReservedRoom(code, { winningScore: 30 });
    intruder.scheduledTournamentMatchId = 'm-intruder';
    intruder.scheduledTournamentId = TA;

    expect(await persistLiveRoomSessionNow(intruder, roster)).toBe(false);
    expect(await persistLiveRoomSessionNow(intruder, roster)).toBe(false);
    const refusals = alertsTagged('live_session_overwrite_refused');
    expect(refusals).toHaveLength(1);
    expect(refusals[0][1]).toMatchObject({
      level: 'error',
      fingerprint: ['tournament-live-session-overwrite-refused', code],
      tags: { room_code: code, match_id: 'm-intruder', tournament_id: TA },
      extra: { storedMatchId: original.matchId, storedStatus: 'playing', roomMatchId: intruder.matchId },
    });
    expect(h.liveSessions.get(code)).toMatchObject({ match_id: original.matchId });

    vi.setSystemTime(new Date(Date.parse('2026-10-07T12:00:00Z') + ALERT_RESEND_INTERVAL_MS));
    expect(await persistLiveRoomSessionNow(intruder, roster)).toBe(false);
    expect(alertsTagged('live_session_overwrite_refused')).toHaveLength(2);
  });
});

describe('failure isolation', () => {
  it('start-time dispatch: one match throwing does not stop the tournament\'s other dispatches', async () => {
    const store = {
      tournaments: [tournament(TA)],
      matches: [matchRow('qf1', TA, 1, 'T5D000AR1M1'), matchRow('qf2', TA, 2, 'T5D000AR1M2')],
    };

    const dispatched = await dispatchScheduledStartMatches(makeIo(), TA, makePersistence(store, { restoreRoomCode: 'T5D000AR1M1' }));

    expect(dispatched).toBe(1);
    expect(store.matches.find((m) => m.id === 'qf1')!.status).toBe('waiting');
    expect(store.matches.find((m) => m.id === 'qf2')!.status).toBe('ready');
    expect(alertsTagged('start_dispatch_failed')).toHaveLength(1);
    expect(alertsTagged('start_dispatch_failed')[0][1]).toMatchObject({
      tags: { match_id: 'qf1', error_code: 'room_persistence_unavailable' },
    });
  });

  it('scheduler tick: one tournament\'s start-time dispatch throwing does not skip the others or the reconcile', async () => {
    h.schedulerTournaments = [tournament(TA), tournament(TB)];
    const dispatchedFor: string[] = [];
    h.dispatchStartOverride = async (_io, tournamentId: string) => {
      if (tournamentId === TA) throw new Error('dispatch_failed');
      dispatchedFor.push(tournamentId);
      return 0;
    };
    const reconciled = vi.fn(async () => 0);
    h.reconcileOverride = reconciled;

    startTournamentScheduler(makeIo());

    await vi.waitFor(() => expect(reconciled).toHaveBeenCalledTimes(1));
    expect(dispatchedFor).toEqual([TB]);
    const alerts = alertsTagged('start_dispatch_failed');
    expect(alerts).toHaveLength(1);
    expect(alerts[0][1]).toMatchObject({ tags: { tournament_id: TA, error_code: 'dispatch_failed' } });
  });

  it('boot recovery: one tournament whose matches cannot be read does not skip the later ones', async () => {
    const store = {
      tournaments: [tournament(TA), tournament(TB)],
      matches: [
        matchRow('a-qf1', TA, 1, 'T5D000AR1M1', { status: 'ready', ready_at: new Date().toISOString() }),
        matchRow('b-qf1', TB, 1, 'T5D000BR1M1', { status: 'ready', ready_at: new Date().toISOString() }),
      ],
    };

    const result = await recoverTournamentMatches(makeIo(), makePersistence(store, { fetchMatchesFor: TA }));

    expect(result.readyRecovered).toBe(1);
    expect(() => getRoom('T5D000BR1M1')).not.toThrow();
    expect(() => getRoom('T5D000AR1M1')).toThrow();
    const alerts = alertsTagged('recovery_failed');
    expect(alerts).toHaveLength(1);
    expect(alerts[0][1]).toMatchObject({
      fingerprint: ['tournament-step-failed', 'recovery', TA],
      tags: { tournament_id: TA, error_code: 'matches_read_failed' },
    });
  });

  it('no-show reconciler: one tournament whose matches cannot be read does not skip the later ones', async () => {
    const expired = new Date(Date.now() - 60_000).toISOString();
    const joinedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    const store = {
      tournaments: [tournament(TA), tournament(TB)],
      matches: [
        matchRow('a-qf1', TA, 1, 'T5D000AR1M1', { status: 'ready', ready_deadline_at: expired, player1_joined_at: joinedAt }),
        matchRow('b-qf1', TB, 1, 'T5D000BR1M1', { status: 'ready', ready_deadline_at: expired, player1_joined_at: joinedAt }),
        matchRow('b-sf1', TB, 1, '', { round: 2, player1_id: null, player2_id: null }),
      ],
    };
    createReservedRoom('T5D000BR1M1', { winningScore: 30 });
    const persistence = makePersistence(store, { fetchMatchesFor: TA });

    const resolved = await reconcileExpiredReadyMatches(makeIo(), new Date(), persistence, structuredClone(store.tournaments) as any);

    expect(resolved).toBe(1);
    expect(store.matches.find((m) => m.id === 'b-qf1')).toMatchObject({ status: 'completed', winner_id: U[0] });
    expect(store.matches.find((m) => m.id === 'a-qf1')).toMatchObject({ status: 'ready', winner_id: null });
    expect(alertsTagged('reconcile_failed')).toHaveLength(1);
    expect(alertsTagged('reconcile_failed')[0][1]).toMatchObject({ tags: { tournament_id: TA } });
  });
});
