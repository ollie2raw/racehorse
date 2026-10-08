/**
 * No-show rules (reconcileExpiredReadyMatches) and the event-expiry alert
 * label.
 *
 *   absent human vs present human → present human advances
 *   absent human vs Fritz         → Fritz advances (an absent human never
 *                                   beats a present opponent)
 *   both humans absent            → higher seed advances administratively
 *                                   (double_no_show_higher_seed_advanced)
 *
 * Includes the A3 case tournamentHealth.test.ts keeps as a todo: a registered
 * human who never joins is not crowned in a Fritz-filled bracket.
 *
 * Real: engine, dispatch, rooms, bot seating, the scheduler. Faked:
 * `supabaseFetch`, tournament rows (an EnginePersistence passed in; completion
 * through the in-memory port of `complete_tournament_match`), Sentry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const h = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  schedulerTournaments: [] as Array<Record<string, unknown>>,
  failTournamentPatch: false,
}));

vi.mock('@sentry/node', () => ({ captureMessage: h.captureMessage, captureException: vi.fn() }));
vi.mock('../social/activityWriter', () => ({
  writeTournamentActivity: vi.fn().mockResolvedValue(undefined),
  writeMatchActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../supabaseUtils', () => ({
  isSupabaseTimeoutError: () => false,
  supabaseFetch: vi.fn(async (path: string, init?: { method?: string }) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    // The backstop's cancel (cancel_tournament_if_bracket_unchanged since Phase 2C).
    if (path.includes('/rpc/cancel_tournament_if_bracket_unchanged') && h.failTournamentPatch) {
      throw new Error('tournament_update_failed');
    }
    if (path.startsWith('/rest/v1/scheduled_tournaments?')) {
      if (method === 'PATCH') {
        if (h.failTournamentPatch) throw new Error('tournament_update_failed');
        return [];
      }
      return path.includes('in_progress') ? structuredClone(h.schedulerTournaments) : [];
    }
    return [];
  }),
}));

import { createReservedRoom, getRoom, resetLiveRoomPersistHookForTests, resetRoomRuntimeForTests } from '../rooms';
import { initRoomSession, resetRoomSessionStoresForTests } from '../multiplayer/roomSession';
import { resetLiveRoomPersistenceForTests } from '../multiplayer/roomLivePersistence';
import { dispatchScheduledStartMatches, reconcileExpiredReadyMatches } from './engine';
import { inMemoryMatchRpcForArrayStore } from './inMemoryMatchRpc.testkit';
import type { EnginePersistence } from './persistenceInterface';
import { startTournamentScheduler, stopTournamentScheduler } from './scheduler';
import { resetAlertThrottleForTests } from './tournamentAlerts';

const T = '2a000000-0000-4000-8000-000000000001';
const U1 = '2a000000-0000-4000-8000-0000000000a1';
const U2 = '2a000000-0000-4000-8000-0000000000a2';
const bot = (n: number) => `bot:fritz:${T}:${n}`;

function makeIo() {
  return {
    sockets: { sockets: new Map(), adapter: { rooms: new Map() } },
    to: () => ({ emit: vi.fn() }),
    emit: vi.fn(),
  } as any;
}

function matchRow(id: string, round: number, matchNumber: number, p1: string | null, p2: string | null, partial: Row = {}): Row {
  return {
    id, tournament_id: T, round, match_number: matchNumber, player1_id: p1, player2_id: p2,
    winner_id: null, room_code: `T2A0000R${round}M${matchNumber}`, status: 'waiting', ready_at: null, ready_deadline_at: null,
    started_at: null, completed_at: null, player1_joined_at: null, player2_joined_at: null,
    winner_source: null, status_reason: null, forfeit_user_id: null, no_show_user_id: null,
    bot_tier: null, player1_score: null, player2_score: null, ...partial,
  };
}

type Store = { tournament: Row; matches: Row[]; regs: Row[] };

function makeStore(matches: Row[], seeds: Record<string, number> = { [U1]: 1, [U2]: 2 }): Store {
  const startMs = Date.now() - 10 * 60_000;
  return {
    tournament: {
      id: T, scheduled_start: new Date(startMs).toISOString(), registration_open_at: '', registration_close_at: '',
      status: 'in_progress', format: '7-tile', win_target: 30, max_players: 8, winner_id: null, created_at: '',
    },
    matches,
    regs: Object.entries(seeds).map(([u, s]) => ({ id: `r-${u}`, tournament_id: T, user_id: u, registered_at: '', seed: s, placement: null, status: 'active' })),
  };
}

function makePersistence(store: Store) {
  const rpc = () => inMemoryMatchRpcForArrayStore(store as any);
  const completions: string[] = [];
  const persistence = {
    fetchTournamentById: async (id: string) => (id === T ? structuredClone(store.tournament) : null),
    fetchTournamentsByStatus: async () => [structuredClone(store.tournament)],
    fetchMatches: async () => structuredClone(store.matches),
    fetchMatchById: async (id: string) => structuredClone(store.matches.find((m) => m.id === id) ?? null),
    fetchMatchByRoomCode: async (code: string) => structuredClone(store.matches.find((m) => m.room_code === code) ?? null),
    fetchRegistrations: async () => structuredClone(store.regs),
    fetchRegistrationsWithProfile: async () => [],
    updateMatch: async (id: string, patch: Row) => { Object.assign(store.matches.find((m) => m.id === id)!, patch); },
    completeTournamentMatch: async (params: any) => {
      const result = await rpc().completeTournamentMatch(params);
      if (result.applied) completions.push(params.matchId);
      return result;
    },
    promoteTournamentMatch: (...args: any[]) => (rpc().promoteTournamentMatch as any)(...args),
    generateTournamentBracket: async () => { throw new Error('not expected'); },
    updateRegistrationPlacement: async () => {},
    updateTournamentStatus: async () => {},
    createReservedRoom,
    getRoom,
  } as unknown as EnginePersistence;
  return { persistence, completions };
}

const expired = () => new Date(Date.now() - 60_000).toISOString();
const joined = () => new Date(Date.now() - 5 * 60_000).toISOString();

/** An expired ready quarterfinal (and the semifinal it feeds), with its room in memory. */
function expiredQf(p1: string, p2: string, partial: Row = {}): Row[] {
  createReservedRoom('T2A0000R1M1', { winningScore: 30 });
  return [
    matchRow('qf1', 1, 1, p1, p2, { status: 'ready', ready_at: joined(), ready_deadline_at: expired(), ...partial }),
    matchRow('sf1', 2, 1, null, null),
  ];
}

const tick = (persistence: EnginePersistence, store: Store, io = makeIo()) =>
  reconcileExpiredReadyMatches(io, new Date(), persistence, [structuredClone(store.tournament) as any]);
const qf1 = (store: Store) => store.matches.find((m) => m.id === 'qf1')!;
const regOf = (store: Store, u: string) => store.regs.find((r) => r.user_id === u)!;

beforeEach(() => {
  h.captureMessage.mockClear();
  h.schedulerTournaments = [];
  h.failTournamentPatch = false;
  resetAlertThrottleForTests();
  resetLiveRoomPersistenceForTests();
  resetLiveRoomPersistHookForTests();
  resetRoomRuntimeForTests();
  resetRoomSessionStoresForTests();
  initRoomSession(makeIo(), {
    resolveSocketIdentity: async () => ({ username: 'Player', userId: null }),
    normalizeUsername: (v: unknown) => (typeof v === 'string' ? v : 'Guest'),
    normalizeUserId: (v: unknown) => (typeof v === 'string' ? v : null),
    tryHydrateMatchmakingRoomShell: async () => 'skipped',
    waitUntilMatchmakingRoomSocketsReady: async () => undefined,
    onAfterMatchStarted: async () => undefined,
    notifyRoomPlayersInGame: () => undefined,
    maybeFinalizeTournamentMatch: () => undefined,
    persistRoomMatchLog: async () => undefined,
    onGameOver: () => null,
    finalizeTournamentMatch: () => undefined,
  } as any);
});
afterEach(() => {
  stopTournamentScheduler();
});

describe('no-show rules', () => {
  it.each([
    { seat: 'Fritz second', p1: U1, p2: bot(8), absent: U1, reason: 'player1_no_show' },
    { seat: 'Fritz first', p1: bot(8), p2: U1, absent: U1, reason: 'player2_no_show' },
  ])('absent human vs Fritz ($seat): Fritz advances, the human is a no-show', async ({ p1, p2, absent, reason }) => {
    const store = makeStore(expiredQf(p1, p2, { bot_tier: 'standard' }), { [U1]: 1 });
    const { persistence } = makePersistence(store);

    expect(await tick(persistence, store)).toBe(1);

    expect(qf1(store)).toMatchObject({
      status: 'completed', winner_id: bot(8), winner_source: 'no_show', no_show_user_id: absent, status_reason: reason,
    });
    expect(regOf(store, U1).status).toBe('eliminated');
    expect(store.matches.find((m) => m.id === 'sf1')?.player1_id).toBe(bot(8));
  });

  it.each([
    { seat: 'present human in seat 1', p1joined: true, winner: U1, absent: U2, reason: 'player2_no_show' },
    { seat: 'present human in seat 2', p1joined: false, winner: U2, absent: U1, reason: 'player1_no_show' },
  ])('absent human vs present human ($seat): the present human advances', async ({ p1joined, winner, absent, reason }) => {
    const store = makeStore(expiredQf(U1, U2, p1joined ? { player1_joined_at: joined() } : { player2_joined_at: joined() }));
    const { persistence } = makePersistence(store);

    await tick(persistence, store);

    expect(qf1(store)).toMatchObject({
      status: 'completed', winner_id: winner, winner_source: 'no_show', no_show_user_id: absent, status_reason: reason,
    });
    expect(regOf(store, absent).status).toBe('eliminated');
  });

  it('both humans absent: the higher seed advances, recorded as an administrative advance', async () => {
    const store = makeStore(expiredQf(U1, U2), { [U1]: 6, [U2]: 3 });
    const { persistence } = makePersistence(store);

    await tick(persistence, store);

    expect(qf1(store)).toMatchObject({
      status: 'completed', winner_id: U2, winner_source: 'no_show', no_show_user_id: null,
      status_reason: 'double_no_show_higher_seed_advanced',
    });
  });

  it('a retried tick does not complete the same match twice', async () => {
    const store = makeStore(expiredQf(U1, bot(8), { bot_tier: 'standard' }), { [U1]: 1 });
    const { persistence, completions } = makePersistence(store);
    const io = makeIo();

    expect(await tick(persistence, store, io)).toBe(1);
    expect(await tick(persistence, store, io)).toBe(0);

    expect(completions.filter((id) => id === 'qf1')).toHaveLength(1);
    expect(io.emit.mock.calls.filter(([e]: [string]) => e === 'tournament:match_updated')).toHaveLength(1);
  });

  it('A3: a registered human who never joins is not crowned in a Fritz-filled bracket', async () => {
    const store = makeStore([
      ...expiredQf(U1, bot(8), { bot_tier: 'standard' }).filter((m) => m.id === 'qf1'),
      matchRow('qf2', 1, 2, bot(4), bot(5), { bot_tier: 'standard' }),
      matchRow('qf3', 1, 3, bot(3), bot(6), { bot_tier: 'standard' }),
      matchRow('qf4', 1, 4, bot(2), bot(7), { bot_tier: 'standard' }),
      matchRow('sf1', 2, 1, null, null),
      matchRow('sf2', 2, 2, null, null),
      matchRow('f1', 3, 1, null, null),
    ], { [U1]: 1 });
    const { persistence } = makePersistence(store);
    const io = makeIo();

    for (let i = 0; i < 6 && store.tournament.status !== 'completed'; i += 1) {
      await dispatchScheduledStartMatches(io, T, persistence);
      await tick(persistence, store, io);
    }

    expect(store.tournament.status).toBe('completed');
    expect(store.tournament.winner_id).toMatch(/^bot:fritz:/);
    expect(regOf(store, U1)).toMatchObject({ status: 'eliminated', placement: 5 });
    expect(qf1(store)).toMatchObject({ winner_id: bot(8), no_show_user_id: U1 });
  });
});

describe('event-expiry alert label', () => {
  it('a failing cancel of an expired event is reported as event_expiry, not start_dispatch', async () => {
    h.schedulerTournaments = [{
      id: T, scheduled_start: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
      registration_open_at: '', registration_close_at: '', status: 'in_progress', format: '7-tile',
      win_target: 30, max_players: 8, winner_id: null, created_at: '',
    }];
    h.failTournamentPatch = true;

    startTournamentScheduler(makeIo());

    await vi.waitFor(() => expect(h.captureMessage).toHaveBeenCalled());
    const tags = h.captureMessage.mock.calls.map(([, ctx]) => ctx?.tags?.tournament_alert);
    expect(tags).toContain('event_expiry_failed');
    expect(tags).not.toContain('start_dispatch_failed');
  });
});
