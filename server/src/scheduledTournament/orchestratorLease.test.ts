/**
 * The orchestrator lease in the server (Phase 2C): ownership epochs, the
 * heartbeat, loss, takeover, stage-boundary checks, the local in-flight
 * guard, recovery once per epoch, and drain-then-release on shutdown.
 *
 * Real: OrchestratorLease and the scheduler's orchestration loop. The lease
 * backend is the in-memory port of the M3 RPCs (orchestratorLease.testkit),
 * on the fake clock; two OrchestratorLease objects sharing one store are two
 * server processes. The orchestration stages themselves (lifecycle reads,
 * reconcile, recovery, seed RPC) are mocks that record calls and can be held
 * open. The database lease itself is proven in tournament-db-verify.sh §11.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  fetchDueLifecycleTournaments: vi.fn(async (): Promise<unknown[]> => []),
  fetchTournamentsByStatus: vi.fn(async (): Promise<unknown[]> => []),
  reconcileExpiredReadyMatches: vi.fn(async () => 0),
  recoverTournamentMatches: vi.fn(async () => ({ readyRecovered: 0, inProgressRecovered: 0 })),
  supabaseFetch: vi.fn(async () => null),
  captureMessage: vi.fn(),
}));

vi.mock('@sentry/node', () => ({ captureMessage: m.captureMessage, captureException: vi.fn() }));
vi.mock('../supabaseUtils', () => ({ isSupabaseTimeoutError: () => false, supabaseFetch: m.supabaseFetch }));
vi.mock('./persistence', () => ({
  fetchDueLifecycleTournaments: m.fetchDueLifecycleTournaments,
  fetchTournamentsByStatus: m.fetchTournamentsByStatus,
}));
vi.mock('./engine', () => ({
  openRegistration: vi.fn(),
  closeRegistrationAndStart: vi.fn(),
  dispatchScheduledStartMatches: vi.fn(),
  reconcileExpiredReadyMatches: m.reconcileExpiredReadyMatches,
  cancelTournamentBeforeStart: vi.fn(),
}));
vi.mock('./recovery', () => ({ recoverTournamentMatches: m.recoverTournamentMatches }));

import { OrchestratorLease, type LeaseBackend } from './orchestratorLease';
import { inMemoryLeaseBackend, inMemoryLeaseStore, type InMemoryLeaseStore } from './orchestratorLease.testkit';
import { drainTournamentOrchestrator, runOrchestrationTick, startTournamentScheduler, stopTournamentScheduler, whenOrchestrationIdle } from './scheduler';
import { resetAlertThrottleForTests } from './tournamentAlerts';

const TTL = 120_000;
const HEARTBEAT = 30_000;
const io = { emit: vi.fn() } as any;

/**
 * These tests never step the wall clock, so the fake-timer Date is the
 * monotonic clock here (vitest does not fake performance.now). The clock-skew
 * tests below drive a separate monotonic clock instead.
 */
const fakeTimerMonotonic = () => Date.now();

function leaseOn(store: InMemoryLeaseStore, ownerId: string) {
  return new OrchestratorLease({ backend: inMemoryLeaseBackend(store), ownerId, ttlMs: TTL, heartbeatMs: HEARTBEAT, monotonicNow: fakeTimerMonotonic });
}

/** A promise the test resolves. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** Let pending microtasks (and the fake-timer callbacks they schedule) run. */
async function flush() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

const seedCalls = () => m.supabaseFetch.mock.calls.filter(([path]) => String(path).includes('ensure_tournament_seed_window')).length;
const lostAlerts = () => m.captureMessage.mock.calls.filter(([msg]) => msg === '[tournament] orchestrator_lease_lost').length;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-08T12:00:00.000Z'));
  vi.clearAllMocks();
  m.fetchDueLifecycleTournaments.mockImplementation(async () => []);
  m.fetchTournamentsByStatus.mockImplementation(async () => []);
  resetAlertThrottleForTests();
});
afterEach(() => {
  stopTournamentScheduler();
  vi.useRealTimers();
});

describe('ownership', () => {
  it('two processes: only one owns the lease and runs orchestration; the standby does no lifecycle work', async () => {
    const store = inMemoryLeaseStore();
    const a = leaseOn(store, 'instance-a');
    expect(await a.ensure()).toMatchObject({ held: true, newEpoch: true });

    startTournamentScheduler(io, { lease: leaseOn(store, 'instance-b') });
    await whenOrchestrationIdle();
    expect(await runOrchestrationTick()).toBe('standby');

    expect(m.fetchDueLifecycleTournaments).not.toHaveBeenCalled();
    expect(m.fetchTournamentsByStatus).not.toHaveBeenCalled();
    expect(m.reconcileExpiredReadyMatches).not.toHaveBeenCalled();
    expect(m.recoverTournamentMatches).not.toHaveBeenCalled();
    expect(seedCalls()).toBe(0); // the seed fallback runs only for the owner
    a.stopHeartbeat();
  });

  it('the owner runs recovery once per epoch, then the stages; the seed fallback once, then every 6 h', async () => {
    startTournamentScheduler(io, { lease: leaseOn(inMemoryLeaseStore(), 'instance-a') });
    await whenOrchestrationIdle();
    await vi.advanceTimersByTimeAsync(30_000);
    await whenOrchestrationIdle();
    await vi.advanceTimersByTimeAsync(30_000);
    await whenOrchestrationIdle();

    expect(m.recoverTournamentMatches).toHaveBeenCalledTimes(1);
    expect(m.reconcileExpiredReadyMatches.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(seedCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(6 * 60 * 60_000);
    await whenOrchestrationIdle();
    expect(seedCalls()).toBe(2);
  });

  it('an overlapping interval never starts a second local tick (skipped, not queued)', async () => {
    const hold = deferred<unknown[]>();
    m.fetchDueLifecycleTournaments.mockImplementationOnce(() => hold.promise);
    startTournamentScheduler(io, { lease: leaseOn(inMemoryLeaseStore(), 'instance-a') });
    await flush();

    expect(await runOrchestrationTick()).toBe('skipped_in_flight');
    await vi.advanceTimersByTimeAsync(90_000); // three more intervals fire while it is held
    expect(m.fetchDueLifecycleTournaments).toHaveBeenCalledTimes(1);

    hold.resolve([]);
    await flush();
    expect(await runOrchestrationTick()).toBe('completed');
    expect(m.fetchDueLifecycleTournaments).toHaveBeenCalledTimes(2);
  });
});

describe('heartbeat, loss and takeover', () => {
  it('the heartbeat keeps the lease while a long tick is blocked (independent of the tick)', async () => {
    const store = inMemoryLeaseStore();
    const lease = leaseOn(store, 'instance-a');
    const hold = deferred<unknown[]>();
    m.fetchDueLifecycleTournaments.mockImplementationOnce(() => hold.promise);
    startTournamentScheduler(io, { lease });
    await flush();

    await vi.advanceTimersByTimeAsync(5 * 60_000); // 2.5x the TTL, tick still blocked
    expect(store.calls.filter((c) => c === 'renew:instance-a').length).toBe(10);
    expect(lease.holds()).toBe(true);
    expect(store.row!.until).toBeGreaterThan(Date.now());

    hold.resolve([]);
    await flush();
  });

  it('a refused renewal (taken over) marks the lease lost at once, with an alert', async () => {
    const store = inMemoryLeaseStore();
    const lease = leaseOn(store, 'instance-a');
    await lease.ensure();
    store.row = { owner: 'instance-b', token: 'b-token', until: Date.now() + TTL }; // another epoch

    await lease.renewNow();

    expect(lease.holds()).toBe(false);
    expect(lostAlerts()).toBe(1);
  });

  it('renewals that error keep ownership only until the local deadline, then it is lost', async () => {
    const store = inMemoryLeaseStore();
    const lease = leaseOn(store, 'instance-a');
    await lease.ensure();
    store.failRenews = 100;

    await vi.advanceTimersByTimeAsync(90_000);
    expect(lease.holds()).toBe(true); // 90 s < TTL − safety margin
    await vi.advanceTimersByTimeAsync(30_000);
    expect(lease.holds()).toBe(false);
  });

  it('loss between stages stops the rest of the tick (no release; the new owner continues)', async () => {
    const store = inMemoryLeaseStore();
    const lease = leaseOn(store, 'instance-a');
    m.fetchDueLifecycleTournaments.mockImplementationOnce(async () => {
      // B takes over while A is in the lifecycle stage; A's next renewal sees it.
      store.row = { owner: 'instance-b', token: 'b-token', until: Date.now() + TTL };
      await lease.renewNow();
      return [];
    });
    startTournamentScheduler(io, { lease });
    await whenOrchestrationIdle();

    expect(m.fetchDueLifecycleTournaments).toHaveBeenCalledTimes(1);
    expect(lease.holds()).toBe(false);
    expect(m.fetchTournamentsByStatus).not.toHaveBeenCalled();
    expect(m.reconcileExpiredReadyMatches).not.toHaveBeenCalled();
    expect(store.calls).not.toContain('release:instance-a');
    expect(store.row).toMatchObject({ owner: 'instance-b', token: 'b-token' });
  });

  it('the same process re-acquiring after a loss is a new epoch: new token, recovery runs again', async () => {
    const store = inMemoryLeaseStore();
    const lease = leaseOn(store, 'instance-a');
    startTournamentScheduler(io, { lease });
    await whenOrchestrationIdle();
    const firstToken = store.row!.token;
    expect(m.recoverTournamentMatches).toHaveBeenCalledTimes(1);

    store.row = { owner: 'instance-b', token: 'b-token', until: Date.now() + 10_000 }; // B owns briefly…
    await lease.renewNow();
    expect(lease.holds()).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000); // …then B's lease expires; A's next tick re-acquires
    await whenOrchestrationIdle();

    expect(store.row!.owner).toBe('instance-a');
    expect(store.row!.token).not.toBe(firstToken);
    expect(lease.epochCount).toBe(2);
    expect(m.recoverTournamentMatches).toHaveBeenCalledTimes(2);
  });

  it('abrupt owner loss (no release): the standby takes over after expiry with a new token and recovers', async () => {
    const store = inMemoryLeaseStore();
    const a = leaseOn(store, 'instance-a');
    await a.ensure();
    const aToken = store.row!.token;
    a.stopHeartbeat(); // the process died

    const b = leaseOn(store, 'instance-b');
    expect(await b.ensure()).toMatchObject({ held: false });
    await vi.advanceTimersByTimeAsync(TTL);
    const takeover = await b.ensure();

    expect(takeover).toMatchObject({ held: true, newEpoch: true });
    expect(store.row).toMatchObject({ owner: 'instance-b' });
    expect(store.row!.token).not.toBe(aToken);
    // The crashed owner's token can no longer renew or release.
    expect(await inMemoryLeaseBackend(store).renew('instance-a', aToken, 120)).toEqual({ renewed: false });
    expect(await inMemoryLeaseBackend(store).release('instance-a', aToken)).toEqual({ released: false });
    expect(store.row).toMatchObject({ owner: 'instance-b' });
    b.stopHeartbeat();
  });

  it('a stale owner cannot release the replacement owner\'s lease', async () => {
    const store = inMemoryLeaseStore();
    const a = leaseOn(store, 'instance-a');
    await a.ensure();
    a.stopHeartbeat(); // stalls past its lease
    await vi.advanceTimersByTimeAsync(TTL);
    const b = leaseOn(store, 'instance-b');
    await b.ensure();
    const bRow = structuredClone(store.row);

    expect(await a.release()).toBe(false);

    expect(store.row).toEqual(bRow);
    expect(store.calls).not.toContain('release:instance-a'); // refused locally before any call
    b.stopHeartbeat();
  });
});

describe('graceful shutdown', () => {
  it('drains the operation in flight (heartbeat still renewing), then releases this epoch', async () => {
    const store = inMemoryLeaseStore();
    const hold = deferred<unknown[]>();
    m.fetchDueLifecycleTournaments.mockImplementationOnce(() => hold.promise);
    startTournamentScheduler(io, { lease: leaseOn(store, 'instance-a') });
    await flush();

    const drained = drainTournamentOrchestrator({ timeoutMs: 600_000 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.calls.filter((c) => c === 'renew:instance-a').length).toBe(2); // kept alive while draining
    expect(store.calls).not.toContain('release:instance-a');
    expect(await runOrchestrationTick()).toBe('draining'); // no new work

    hold.resolve([]);
    expect(await drained).toEqual({ drained: true, released: true });
    expect(store.row!.until).toBeLessThanOrEqual(Date.now()); // immediately acquirable
    expect(await leaseOn(store, 'instance-b').ensure()).toMatchObject({ held: true, newEpoch: true });
  });

  it('a drain that exceeds the deadline does NOT release: the lease expires by TTL', async () => {
    const store = inMemoryLeaseStore();
    m.fetchDueLifecycleTournaments.mockImplementationOnce(() => new Promise(() => {}));
    startTournamentScheduler(io, { lease: leaseOn(store, 'instance-a') });
    await flush();

    const drained = drainTournamentOrchestrator({ timeoutMs: 10_000 });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await drained).toEqual({ drained: false, released: false });
    expect(store.calls).not.toContain('release:instance-a');
    expect(store.row).toMatchObject({ owner: 'instance-a' });
    expect(store.row!.until).toBeGreaterThan(Date.now());
  });
});

describe('lease unavailable (M3 missing, or the RPC erroring)', () => {
  it('stands by doing no work, and alerts only once it has lasted three ticks', async () => {
    const backend = {
      acquire: vi.fn(async () => { throw new Error('function acquire_tournament_orchestrator_lease does not exist'); }),
      renew: vi.fn(),
      release: vi.fn(),
    };
    const lease = new OrchestratorLease({ backend: backend as any, ownerId: 'p1', ttlMs: TTL, heartbeatMs: HEARTBEAT, monotonicNow: fakeTimerMonotonic });
    const unavailableAlerts = () => m.captureMessage.mock.calls.filter(([msg]) => msg === '[tournament] orchestrator_lease_unavailable').length;
    startTournamentScheduler(io, { lease });
    await whenOrchestrationIdle();
    expect(await runOrchestrationTick()).toBe('standby');
    expect(unavailableAlerts()).toBe(0);
    expect(await runOrchestrationTick()).toBe('standby');
    expect(unavailableAlerts()).toBe(1);
    expect(m.fetchDueLifecycleTournaments).not.toHaveBeenCalled();
    expect(m.recoverTournamentMatches).not.toHaveBeenCalled();
    expect(seedCalls()).toBe(0);

    // The RPC comes back: this process acquires and orchestrates; the count resets.
    backend.acquire.mockImplementation(async () => ({ acquired: true, leaseToken: 'tok-1' }) as any);
    expect(await runOrchestrationTick()).toBe('completed');
    expect(m.recoverTournamentMatches).toHaveBeenCalledTimes(1);
  });
});

/**
 * Lease clock (Phase 2C.1). Three independent clocks: the host WALL clock
 * (Date — stepped ±5 min here), this process's MONOTONIC clock (`mono`), and
 * the DATABASE clock (`db`), which grants `leased_until = db + TTL` when a
 * request executes. Real elapsed time moves `mono` and `db` together; request
 * latency moves them before the response arrives.
 */
describe('lease clock: monotonic, conservative, independent of the host wall clock', () => {
  const SAFETY = 10_000;
  function clocks() {
    const c = { mono: 1_000_000, db: 5_000_000, until: 0, owner: '' as string, token: '' as string, latency: 0, dbExecAfter: 0 };
    /** Advance real time: both the monotonic and the database clocks. */
    const elapse = (ms: number) => { c.mono += ms; c.db += ms; };
    const backend: LeaseBackend = {
      async acquire(owner, ttlSeconds) {
        elapse(c.dbExecAfter);                         // request in flight before it executes
        if (c.until > c.db && c.owner !== owner) { elapse(c.latency - c.dbExecAfter); return { acquired: false, leaseToken: null }; }
        c.owner = owner; c.token = `tok-${c.db}`; c.until = c.db + ttlSeconds * 1000;
        elapse(c.latency - c.dbExecAfter);             // response in flight
        return { acquired: true, leaseToken: c.token };
      },
      async renew(owner, token, ttlSeconds) {
        elapse(c.dbExecAfter);
        const ok = c.owner === owner && c.token === token && c.until > c.db;
        if (ok) c.until = c.db + ttlSeconds * 1000;
        elapse(c.latency - c.dbExecAfter);
        return { renewed: ok };
      },
      async release() { return { released: false }; },
    };
    const lease = (ttlMs = TTL) => new OrchestratorLease({ backend, ownerId: 'p1', ttlMs, heartbeatMs: 1e9, safetyMs: SAFETY, monotonicNow: () => c.mono });
    /** Set the monotonic clock to `sent + ms` (and the database clock with it). */
    const at = (sent: number, ms: number) => elapse(sent + ms - c.mono);
    return { c, backend, lease, elapse, at };
  }

  it('host wall clock 5 minutes AHEAD does not shorten or extend ownership', async () => {
    const { c, lease, at } = clocks();
    const l = lease();
    const sent = c.mono;
    expect((await l.ensure()).held).toBe(true);
    vi.setSystemTime(Date.now() + 5 * 60_000);
    at(sent, TTL - SAFETY - 1);
    expect(l.holds()).toBe(true);
    at(sent, TTL - SAFETY);
    expect(l.holds()).toBe(false);
    l.stopHeartbeat();
  });

  it('host wall clock 5 minutes BEHIND does not extend ownership', async () => {
    const { c, lease, at } = clocks();
    const l = lease();
    const sent = c.mono;
    await l.ensure();
    vi.setSystemTime(Date.now() - 5 * 60_000);
    at(sent, TTL - SAFETY);
    // With a wall-clock deadline this would still "hold" for another 5 minutes.
    expect(l.holds()).toBe(false);
    expect(c.until - c.db).toBeGreaterThanOrEqual(SAFETY); // the database lease has not even expired yet
    l.stopHeartbeat();
  });

  it('a slow acquire shortens the local interval: it runs from when the request was SENT', async () => {
    const { c, lease, at } = clocks();
    c.latency = 20_000; c.dbExecAfter = 1_000;    // executes 1 s after send, response 20 s after send
    const l = lease();
    const sent = c.mono;
    await l.ensure();
    expect(c.mono - sent).toBe(20_000);
    at(sent, TTL - SAFETY - 1);
    expect(l.holds()).toBe(true);
    at(sent, TTL - SAFETY);
    expect(l.holds()).toBe(false);                // only 90 s after the response
    // …while the database lease (granted at send + 1 s) is still valid for 11 s.
    expect(c.until - c.db).toBe(SAFETY + 1_000);
    l.stopHeartbeat();
  });

  it('local ownership ends at least the safety margin before the database expiry: no other process can hold it yet', async () => {
    const { c, backend, lease, at } = clocks();
    const l = lease();
    const sent = c.mono;
    await l.ensure();
    at(sent, TTL - SAFETY);
    expect(l.holds()).toBe(false);
    // The database still refuses a second owner at this moment: the local view lapsed first.
    expect((await backend.acquire('p2', TTL / 1000)).acquired).toBe(false);
    l.stopHeartbeat();
  });

  it('a successful heartbeat sets a fresh conservative interval from the renewal\'s send time', async () => {
    const { c, lease, at } = clocks();
    const l = lease();
    await l.ensure();
    at(c.mono, 30_000);
    c.latency = 5_000;
    const renewSent = c.mono;
    await l.renewNow();
    expect(c.mono - renewSent).toBe(5_000);
    at(renewSent, TTL - SAFETY - 1);
    expect(l.holds()).toBe(true);
    at(renewSent, TTL - SAFETY);
    expect(l.holds()).toBe(false);
    l.stopHeartbeat();
  });

  it('a failed heartbeat keeps only the previous interval, then ownership is lost; a refused one loses it at once', async () => {
    const { c, backend, lease, at } = clocks();
    const l = lease();
    const sent = c.mono;
    await l.ensure();
    const realRenew = backend.renew;
    backend.renew = async () => { throw new Error('fetch failed'); };
    at(sent, 30_000);
    await l.renewNow();
    expect(l.holds()).toBe(true);                 // within the previous interval
    at(sent, TTL - SAFETY);
    await l.renewNow();
    expect(l.holds()).toBe(false);
    expect(lostAlerts()).toBe(1);

    resetAlertThrottleForTests(); // the lost alert is throttled per 10 min; this is a separate scenario
    const l2 = lease();
    c.until = 0;
    await l2.ensure();
    backend.renew = async () => ({ renewed: false });
    await l2.renewNow();
    expect(l2.holds()).toBe(false);
    expect(lostAlerts()).toBe(2);
    backend.renew = realRenew;
  });

  it('the local interval uses the TTL actually granted (whole seconds, never rounded up)', async () => {
    const { c, backend, lease, at } = clocks();
    const spy = vi.spyOn(backend, 'acquire');
    const l = lease(30_900);
    const sent = c.mono;
    await l.ensure();
    expect(spy).toHaveBeenCalledWith('p1', 30);
    at(sent, 30_000 - SAFETY);
    expect(l.holds()).toBe(false);
    l.stopHeartbeat();
  });
});
