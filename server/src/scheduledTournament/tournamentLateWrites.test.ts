/**
 * Orchestrator writes decided from an older read never overwrite newer state
 * (Phase 2C prerequisite). Each case: process A reads valid state, process B
 * changes it, A's stale write then executes — and is refused (0 rows), with
 * B's state left exactly as B wrote it, every field, not only status.
 *
 * B's change is injected at the precise point inside A's own code path (a
 * persistence-call hook), so the interleaving is deterministic. The fake
 * persistence applies the conditional writes the way the database does (all
 * expected fields must match, else nothing is written); the real-PostgreSQL
 * races are in scripts/tournament-db-verify.sh §10.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('../social/activityWriter', () => ({
  writeTournamentActivity: vi.fn().mockResolvedValue(undefined),
  writeMatchActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../supabaseUtils', () => ({ isSupabaseTimeoutError: () => false, supabaseFetch: vi.fn(async () => []) }));

import { createReservedRoom, getRoom, joinRoom, resetLiveRoomPersistHookForTests, resetRoomRuntimeForTests, startGameUnlocked } from '../rooms';
import { getRoomRoster, initRoomSession, resetRoomSessionStoresForTests, setRoomRoster } from '../multiplayer/roomSession';
import { resetLiveRoomPersistenceForTests } from '../multiplayer/roomLivePersistence';
import { openRegistration, reconcileExpiredReadyMatches } from './engine';
import { resolveExpiredTournament } from './eventBackstop';
import { dispatchTournamentMatch, promoteScheduledMatchToInProgress } from './matchDispatch';
import { inMemoryMatchRpcForArrayStore } from './inMemoryMatchRpc.testkit';
import type { EnginePersistence } from './persistenceInterface';
import { bracketSnapshot } from './persistence';
import { resetAlertThrottleForTests } from './tournamentAlerts';

type Row = Record<string, any>;
const T = '4c000000-0000-4000-8000-000000000001';
const U1 = '4c000000-0000-4000-8000-0000000000a1';
const U2 = '4c000000-0000-4000-8000-0000000000a2';
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function makeIo() {
  return { sockets: { sockets: new Map(), adapter: { rooms: new Map() } }, to: () => ({ emit: vi.fn() }), emit: vi.fn() } as any;
}

beforeEach(() => {
  resetLiveRoomPersistenceForTests();
  resetLiveRoomPersistHookForTests();
  resetRoomRuntimeForTests();
  resetRoomSessionStoresForTests();
  resetAlertThrottleForTests();
  initRoomSession(makeIo(), {
    resolveSocketIdentity: async () => ({ username: 'P', userId: null }),
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

function matchRow(id: string, partial: Row = {}): Row {
  return {
    id, tournament_id: T, round: 1, match_number: 1, player1_id: U1, player2_id: U2, winner_id: null,
    room_code: 'T4C00000000AR1M1', status: 'ready', ready_at: iso(-10 * 60_000), ready_deadline_at: iso(-60_000),
    started_at: null, completed_at: null, player1_joined_at: null, player2_joined_at: null,
    winner_source: null, status_reason: null, forfeit_user_id: null, no_show_user_id: null, bot_tier: null,
    player1_score: null, player2_score: null, ...partial,
  };
}

type Store = { tournament: Row; matches: Row[]; regs: Row[] };
type Hooks = { onGetRoom?: () => void; afterFetchMatches?: () => void; afterFetchMatchById?: (n: number) => void; afterFetchRegistrations?: () => void };

/** A persistence whose conditional writes behave as the database's do. */
function makePersistence(store: Store, hooks: Hooks = {}) {
  const rpc = () => inMemoryMatchRpcForArrayStore(store as any);
  const writes: string[] = [];
  let fetchByIdCalls = 0;
  const persistence = {
    fetchTournamentById: async (id: string) => (id === T ? structuredClone(store.tournament) : null),
    fetchTournamentsByStatus: async () => [structuredClone(store.tournament)],
    fetchMatches: async () => {
      const read = structuredClone(store.matches);
      hooks.afterFetchMatches?.();
      return read;
    },
    fetchMatchById: async (id: string) => {
      const read = structuredClone(store.matches.find((m) => m.id === id) ?? null);
      fetchByIdCalls += 1;
      hooks.afterFetchMatchById?.(fetchByIdCalls);
      return read;
    },
    fetchMatchByRoomCode: async (code: string) => structuredClone(store.matches.find((m) => m.room_code === code) ?? null),
    fetchRegistrations: async () => {
      const read = structuredClone(store.regs);
      hooks.afterFetchRegistrations?.();
      return read;
    },
    fetchRegistrationsWithProfile: async () => [],
    updateMatch: async () => { throw new Error('unconditional updateMatch used'); },
    updateMatchIf: async (id: string, expected: Row, patch: Row) => {
      const row = store.matches.find((m) => m.id === id);
      if (!row || Object.entries(expected).some(([k, v]) => (row[k] ?? null) !== (v ?? null))) return false;
      Object.assign(row, patch);
      writes.push(`match:${id}`);
      return true;
    },
    openRegistrationIfDue: async (id: string, now: Date) => {
      if (id !== T || store.tournament.status !== 'upcoming' || Date.parse(store.tournament.registration_open_at) > now.getTime()) return false;
      store.tournament.status = 'registration_open';
      return true;
    },
    cancelTournamentIfNoEntrants: async (id: string, reason: string) => {
      const open = store.tournament.status === 'upcoming' || store.tournament.status === 'registration_open';
      if (id !== T || !open || store.regs.some((r) => r.status === 'registered')) return false;
      Object.assign(store.tournament, { status: 'cancelled', cancel_reason: reason });
      return true;
    },
    cancelTournamentIfBracketUnchanged: async (id: string, expected: Row[], reason: string) => {
      const key = (rows: Row[]) => JSON.stringify([...rows].sort((a, b) => String(a.id).localeCompare(String(b.id))));
      if (id !== T || store.tournament.status !== 'in_progress' || key(bracketSnapshot(store.matches as any)) !== key(expected)) return false;
      Object.assign(store.tournament, { status: 'cancelled', cancel_reason: reason });
      return true;
    },
    updateTournamentStatus: async () => { throw new Error('unconditional updateTournamentStatus used'); },
    completeTournamentMatch: (params: any) => rpc().completeTournamentMatch(params),
    promoteTournamentMatch: (...args: any[]) => (rpc().promoteTournamentMatch as any)(...args),
    generateTournamentBracket: async () => { throw new Error('not expected'); },
    updateRegistrationPlacement: async () => {},
    createReservedRoom,
    getRoom: (code: string) => { hooks.onGetRoom?.(); return getRoom(code); },
  } as unknown as EnginePersistence;
  return { persistence, writes };
}

function seedStore(matches: Row[], tournament: Row = {}): Store {
  return {
    tournament: {
      id: T, status: 'in_progress', scheduled_start: iso(-30 * 60_000), registration_open_at: iso(-60 * 60_000),
      registration_close_at: iso(-32 * 60_000), win_target: 30, max_players: 8, winner_id: null, format: '7-tile', created_at: '', ...tournament,
    },
    matches,
    regs: [U1, U2].map((u, i) => ({ id: `r-${u}`, tournament_id: T, user_id: u, registered_at: '', seed: i + 1, placement: null, status: 'active' })),
  };
}

async function roomFor(code: string, started: boolean) {
  createReservedRoom(code, { winningScore: 30 });
  for (const [seat, user] of [['seat-1', U1], ['seat-2', U2]] as const) {
    joinRoom(code, seat);
    setRoomRoster(code, [...getRoomRoster(code), { id: seat, socketId: '', username: seat, userId: user }]);
  }
  if (started) await startGameUnlocked(code, makeIo());
}

const tick = (store: Store, persistence: EnginePersistence) =>
  reconcileExpiredReadyMatches(makeIo(), new Date(), persistence, [structuredClone(store.tournament) as any]);

describe('stale orchestrator writes are refused; the newer state survives', () => {
  it('open registration: a tournament that moved on (started / re-timed) is never sent back to registration', async () => {
    for (const changed of [{ status: 'in_progress' }, { status: 'cancelled', cancel_reason: 'x' }, { registration_open_at: iso(60 * 60_000) }]) {
      const store = seedStore([], { status: 'upcoming' });
      Object.assign(store.tournament, changed); // B moved it on after A's due-list read
      const before = structuredClone(store.tournament);
      const io = makeIo();
      const { persistence } = makePersistence(store);

      expect(await openRegistration(io, T, persistence)).toBe(false);

      expect(store.tournament).toEqual(before);
      expect(io.emit).not.toHaveBeenCalled();
    }
  });

  it('dispatch: a stale dispatcher never replaces a newer dispatch (room, deadline, reason, status)', async () => {
    const store = seedStore([matchRow('qf1', { status: 'waiting', room_code: '', ready_at: null, ready_deadline_at: null })]);
    const newer = { status: 'in_progress', room_code: 'TNEWER0000000R1M1', ready_at: iso(-5_000), ready_deadline_at: iso(115_000), status_reason: 'all_joined_start_retry', started_at: iso(-1_000) };
    // B dispatches and starts the match right after A's read.
    const { persistence, writes } = makePersistence(store, { afterFetchMatchById: (n) => { if (n === 1) Object.assign(store.matches[0], newer); } });

    const result = await dispatchTournamentMatch(makeIo(), 'qf1', { reason: 'bracket_generated' }, persistence);

    expect(writes).toEqual([]);
    expect(store.matches[0]).toMatchObject(newer);
    expect(result).toMatchObject({ status: 'in_progress', readyDeadlineAt: newer.ready_deadline_at, readyAt: newer.ready_at });
    expect(result.superseded).toBeUndefined();
  });

  it('dispatch: status unchanged (ready → ready) — the stale write still never replaces B\'s room, deadline and reason', async () => {
    // Made ready by bracket advancement, not yet dispatched (no room, no window).
    const store = seedStore([matchRow('sf1', { round: 2, status: 'ready', room_code: '', ready_at: null, ready_deadline_at: null })]);
    const newer = { room_code: 'TNEWER0000000R2M1', ready_at: iso(-5_000), ready_deadline_at: iso(115_000), status_reason: 'room_rehydrated_deadline_extended' };
    const { persistence, writes } = makePersistence(store, { afterFetchMatchById: (n) => { if (n === 1) Object.assign(store.matches[0], newer); } });

    await dispatchTournamentMatch(makeIo(), 'sf1', { reason: 'bracket_generated' }, persistence);

    expect(writes).toEqual([]);
    expect(store.matches[0]).toMatchObject({ status: 'ready', ...newer });
  });

  it('dispatch: a match completed meanwhile is never moved back; nothing is emitted', async () => {
    const store = seedStore([matchRow('qf1', { status: 'waiting', room_code: '', ready_at: null, ready_deadline_at: null })]);
    const done = { status: 'completed', winner_id: U1, winner_source: 'game_over', completed_at: iso(-1_000), status_reason: null };
    const { persistence } = makePersistence(store, { afterFetchMatchById: (n) => { if (n === 1) Object.assign(store.matches[0], done); } });

    const result = await dispatchTournamentMatch(makeIo(), 'qf1', { reason: 'bracket_generated' }, persistence);

    expect(result).toMatchObject({ superseded: true, emittedReady: false });
    expect(store.matches[0]).toMatchObject({ ...done, room_code: '', ready_deadline_at: null });
  });

  it('attach promote: a match decided meanwhile is never moved back to in_progress', async () => {
    const store = seedStore([matchRow('qf1')]);
    const done = { status: 'completed', winner_id: U2, winner_source: 'no_show', no_show_user_id: U1, completed_at: iso(-1) };
    const { persistence } = makePersistence(store, { afterFetchMatchById: () => Object.assign(store.matches[0], done) });

    await promoteScheduledMatchToInProgress('qf1', persistence);

    expect(store.matches[0]).toMatchObject(done);
  });

  it('reconcile ready → in_progress: a match completed meanwhile stays completed', async () => {
    await roomFor('T4C00000000AR1M1', true);
    const store = seedStore([matchRow('qf1', { player1_joined_at: iso(-90_000), player2_joined_at: iso(-90_000) })]);
    const done = { status: 'completed', winner_id: U1, winner_source: 'game_over', completed_at: iso(-1), player1_score: 30, player2_score: 10 };
    const { persistence } = makePersistence(store, { onGetRoom: () => Object.assign(store.matches[0], done) });

    await tick(store, persistence);

    expect(store.matches[0]).toMatchObject(done);
  });

  it('reconcile start-retry extension: A\'s stale extension never replaces B\'s newer deadline and reason', async () => {
    await roomFor('T4C00000000AR1M1', false);
    const store = seedStore([matchRow('qf1', { player1_joined_at: iso(-90_000), player2_joined_at: iso(-90_000) })]);
    const newer = { ready_deadline_at: iso(300_000), status_reason: 'room_rehydrated_deadline_extended' };
    const { persistence, writes } = makePersistence(store, { onGetRoom: () => Object.assign(store.matches[0], newer) });

    await tick(store, persistence);

    expect(writes).toEqual([]);
    expect(store.matches[0]).toMatchObject({ status: 'ready', ...newer });
  });

  it('reconcile rehydration extension: B\'s newer deadline (written while A repaired the room) survives', async () => {
    const store = seedStore([matchRow('qf1', { player1_joined_at: iso(-90_000), room_code: 'T4C00000000BR1M1' })]);
    const newer = { ready_deadline_at: iso(240_000), status_reason: 'all_joined_start_retry' };
    let injected = false;
    const { persistence } = makePersistence(store, {
      // A finds the room missing (getRoom throws), repairs it; B extends during that.
      onGetRoom: () => { if (!injected) { injected = true; Object.assign(store.matches[0], newer); } },
    });

    await tick(store, persistence);

    expect(store.matches[0]).toMatchObject({ status: 'ready', ...newer });
  });

  it('reconcile no-show: a player who joins after the decision is never recorded as a no-show', async () => {
    await roomFor('T4C00000000AR1M1', false);
    const store = seedStore([matchRow('qf1', { player1_joined_at: iso(-90_000) })]);
    const joined = iso(-1);
    // B: U2 attaches right after A read the match list.
    const { persistence } = makePersistence(store, { onGetRoom: () => { store.matches[0].player2_joined_at = joined; } });

    await tick(store, persistence);

    expect(store.matches[0]).toMatchObject({ status: 'ready', winner_id: null, no_show_user_id: null, player2_joined_at: joined });
  });

  it('reconcile no-show: a match that started after the decision is never decided as unplayed', async () => {
    await roomFor('T4C00000000AR1M1', false);
    const store = seedStore([matchRow('qf1', { player1_joined_at: iso(-90_000) })]);
    const started = { status: 'in_progress', started_at: iso(-1) };
    const { persistence } = makePersistence(store, { onGetRoom: () => Object.assign(store.matches[0], started) });

    await tick(store, persistence);

    expect(store.matches[0]).toMatchObject({ ...started, winner_id: null, no_show_user_id: null });
  });

  it('not_enough_players: a registration that lands after the count is read prevents the cancel', async () => {
    const { closeRegistrationAndStart } = await import('./engine');
    const store = seedStore([], { status: 'registration_open', registration_close_at: iso(-1_000) });
    store.regs = [];
    const late = { id: 'r-late', tournament_id: T, user_id: U1, registered_at: iso(-1), seed: null, placement: null, status: 'registered' };
    const { persistence } = makePersistence(store, { afterFetchRegistrations: () => { store.regs.push(late); } });

    const result = await closeRegistrationAndStart(makeIo(), T, persistence);

    expect(result).toEqual({ started: false, reason: 'entrants_arrived' });
    expect(store.tournament.status).toBe('registration_open');
    expect(store.regs).toEqual([late]);
  });

  it('control: an unchanged no-show is still recorded', async () => {
    await roomFor('T4C00000000AR1M1', false);
    const store = seedStore([matchRow('qf1', { player1_joined_at: iso(-90_000) })]);
    const { persistence } = makePersistence(store);

    await tick(store, persistence);

    expect(store.matches[0]).toMatchObject({ status: 'completed', winner_id: U1, no_show_user_id: U2, status_reason: 'player2_no_show' });
  });
});

describe('the event backstop never cancels a bracket that progressed after its judgement', () => {
  /** An expired event whose bracket has no resolvable match: the backstop judges it unrecoverable. */
  function stuckBracket(): Store {
    const done = { status: 'completed', completed_at: iso(-60 * 60_000) };
    return seedStore([
      matchRow('qf1', { ...done, winner_id: U1 }),
      matchRow('sf1', { round: 2, status: 'waiting', player1_id: U1, player2_id: null, room_code: '' }),
      matchRow('f1', { round: 3, status: 'waiting', player1_id: null, player2_id: null, room_code: '' }),
    ], { scheduled_start: iso(-3 * 60 * 60_000) });
  }

  it('progress after the judgement (B fills and starts the semifinal): not cancelled, bracket intact, re-decided next tick', async () => {
    const store = stuckBracket();
    const progress = { player2_id: 'bot:fritz:x:2', status: 'in_progress', started_at: iso(-1), room_code: 'TSF' };
    let reads = 0;
    const { persistence } = makePersistence(store, { afterFetchMatches: () => { reads += 1; if (reads === 1) Object.assign(store.matches[1], progress); } });

    const outcome = await resolveExpiredTournament(makeIo(), T, persistence, new Date(), store.tournament as any);

    expect(outcome).toEqual({ kind: 'deferred_bracket_changed', resolved: 0 });
    expect(store.tournament.status).toBe('in_progress');
    expect(store.matches[1]).toMatchObject(progress);
  });

  it('a non-status change (B repairs room / deadline, status unchanged) also blocks the cancel', async () => {
    const store = stuckBracket();
    let reads = 0;
    const { persistence } = makePersistence(store, { afterFetchMatches: () => { reads += 1; if (reads === 1) store.matches[2].room_code = 'TREPAIRED'; } });

    expect(await resolveExpiredTournament(makeIo(), T, persistence, new Date(), store.tournament as any)).toMatchObject({ kind: 'deferred_bracket_changed' });
    expect(store.tournament.status).toBe('in_progress');
  });

  it('an administrative result decided from an unplayed match never overwrites a real result recorded meanwhile', async () => {
    // Expired event; the human-vs-Fritz quarterfinal was never dispatched -> administrative advance.
    const store = seedStore([
      matchRow('qf1', { player2_id: 'bot:fritz:x:8', ready_at: null, ready_deadline_at: null, room_code: '' }),
      matchRow('sf1', { round: 2, status: 'waiting', player1_id: null, player2_id: null, room_code: '', ready_at: null, ready_deadline_at: null }),
      matchRow('f1', { round: 3, status: 'waiting', player1_id: null, player2_id: null, room_code: '', ready_at: null, ready_deadline_at: null }),
    ], { scheduled_start: iso(-3 * 60 * 60_000) });
    const real = { status: 'completed', winner_id: 'bot:fritz:x:8', winner_source: 'game_over', player1_score: 12, player2_score: 30, completed_at: iso(-1) };
    let reads = 0;
    const { persistence } = makePersistence(store, { afterFetchMatches: () => { reads += 1; if (reads === 1) Object.assign(store.matches[0], real); } });

    await resolveExpiredTournament(makeIo(), T, persistence, new Date(), store.tournament as any).catch(() => undefined);

    expect(store.matches[0]).toMatchObject(real);
  });

  it('control: an unchanged unrecoverable bracket is still cancelled, with its reason', async () => {
    const store = stuckBracket();
    const { persistence } = makePersistence(store);

    const outcome = await resolveExpiredTournament(makeIo(), T, persistence, new Date(), store.tournament as any);

    expect(outcome).toMatchObject({ kind: 'cancelled_unrecoverable', reason: 'active_window_unrecoverable:backstop_no_resolvable_match' });
    expect(store.tournament).toMatchObject({ status: 'cancelled', cancel_reason: 'active_window_unrecoverable:backstop_no_resolvable_match' });
  });
});
