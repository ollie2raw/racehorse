/**
 * Test support for the orchestrator lease: an in-memory backend with the
 * database's semantics (2026-10-08_tournament_orchestrator_lease.sql) —
 * acquire only an absent or expired lease and mint a new token; renew and
 * release only an unexpired lease with the exact owner and token — on a
 * clock the test controls (Date.now, so vi fake timers drive it). Two
 * OrchestratorLease instances sharing one store model two server processes.
 */
import { randomUUID } from 'node:crypto';
import { OrchestratorLease, type LeaseBackend } from './orchestratorLease';

export type InMemoryLeaseStore = {
  row: { owner: string; token: string; until: number } | null;
  calls: string[];
  /** Make the next renew calls throw (a network error), this many times. */
  failRenews: number;
};

export function inMemoryLeaseStore(): InMemoryLeaseStore {
  return { row: null, calls: [], failRenews: 0 };
}

export function inMemoryLeaseBackend(store: InMemoryLeaseStore): LeaseBackend {
  return {
    async acquire(owner, ttlSeconds) {
      store.calls.push(`acquire:${owner}`);
      if (store.row && store.row.until > Date.now()) return { acquired: false, leaseToken: null };
      store.row = { owner, token: randomUUID(), until: Date.now() + ttlSeconds * 1000 };
      return { acquired: true, leaseToken: store.row.token };
    },
    async renew(owner, token, ttlSeconds) {
      store.calls.push(`renew:${owner}`);
      if (store.failRenews > 0) {
        store.failRenews -= 1;
        throw new Error('fetch failed');
      }
      const row = store.row;
      if (!row || row.owner !== owner || row.token !== token || row.until <= Date.now()) return { renewed: false };
      row.until = Date.now() + ttlSeconds * 1000;
      return { renewed: true };
    },
    async release(owner, token) {
      store.calls.push(`release:${owner}`);
      const row = store.row;
      if (!row || row.owner !== owner || row.token !== token || row.until <= Date.now()) return { released: false };
      row.until = Date.now();
      return { released: true };
    },
  };
}

/** A lease this test process always obtains (its own private store). */
export function ownedLease(ownerId = 'test-orchestrator'): OrchestratorLease {
  return new OrchestratorLease({ backend: inMemoryLeaseBackend(inMemoryLeaseStore()), ownerId });
}
