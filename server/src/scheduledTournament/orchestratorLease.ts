import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { performance } from 'node:perf_hooks';
import { childLogger } from '../logger';
import { acquireOrchestratorLease, releaseOrchestratorLease, renewOrchestratorLease } from './persistence';
import { alertTournamentAnomaly } from './tournamentAlerts';

const log = childLogger('tournament:lease');

/** The one lease: Node-side tournament orchestration (see tournament_orchestrator_leases). */
export const TOURNAMENT_ORCHESTRATOR_LEASE_KEY = 'tournament_orchestrator';
export const TOURNAMENT_ORCHESTRATOR_LEASE_TTL_MS_DEFAULT = 120_000;
export const TOURNAMENT_ORCHESTRATOR_HEARTBEAT_MS_DEFAULT = 30_000;
/**
 * This process stops considering itself the owner this long before the lease
 * could expire at the database (local deadline = request sent + granted TTL −
 * margin; the database expiry is at least request sent + TTL), so it never
 * acts on a lease another process may already hold.
 *
 * The local deadline is on a MONOTONIC clock (performance.now), never the wall
 * clock and never the database's absolute `leased_until`: correctness does not
 * depend on the host clock agreeing with PostgreSQL, and a wall-clock step
 * (NTP, manual) can neither extend nor shorten it. Request latency only
 * shortens it (the send time is captured before the request).
 */
export const TOURNAMENT_ORCHESTRATOR_LEASE_SAFETY_MS = 10_000;

/** TTL in ms: TOURNAMENT_ORCHESTRATOR_LEASE_TTL_MS, clamped to what the database accepts (5..600 s). */
export function orchestratorLeaseTtlMs(): number {
  const raw = Number.parseInt(process.env.TOURNAMENT_ORCHESTRATOR_LEASE_TTL_MS ?? '', 10);
  const ms = Number.isFinite(raw) ? raw : TOURNAMENT_ORCHESTRATOR_LEASE_TTL_MS_DEFAULT;
  return Math.min(600_000, Math.max(30_000, ms));
}

/**
 * This process's owner id: host (or platform instance) + pid + a boot UUID,
 * so two instances, two local processes and the old/new process of a deploy
 * never share it. The database lease token, not this id, identifies an
 * ownership epoch.
 */
export function makeOrchestratorOwnerId(): string {
  const instance = process.env.RENDER_INSTANCE_ID || process.env.HOSTNAME || hostname() || 'host';
  return `${instance}:${process.pid}:${randomUUID()}`;
}

export type LeaseBackend = {
  acquire(owner: string, ttlSeconds: number): Promise<{ acquired: boolean; leaseToken: string | null }>;
  renew(owner: string, token: string, ttlSeconds: number): Promise<{ renewed: boolean }>;
  release(owner: string, token: string): Promise<{ released: boolean }>;
};

/** The database backend (the M3 RPCs). */
export function databaseLeaseBackend(key: string = TOURNAMENT_ORCHESTRATOR_LEASE_KEY): LeaseBackend {
  return {
    acquire: async (owner, ttl) => {
      const r = await acquireOrchestratorLease(key, owner, ttl);
      return { acquired: Boolean(r?.acquired && r.lease_token), leaseToken: r?.acquired ? r.lease_token ?? null : null };
    },
    renew: async (owner, token, ttl) => ({ renewed: Boolean((await renewOrchestratorLease(key, owner, token, ttl))?.renewed) }),
    release: async (owner, token) => ({ released: Boolean((await releaseOrchestratorLease(key, owner, token))?.released) }),
  };
}

export type LeaseOwnership = {
  /** This process holds the lease now. */
  held: boolean;
  /** …and it was acquired by this call (a new ownership epoch). */
  newEpoch: boolean;
  /** The epoch's token (null when not held). */
  token: string | null;
};

/**
 * This process's view of the orchestrator lease.
 *
 * - `ensure()` returns the current ownership, acquiring the lease when this
 *   process does not hold it (a new epoch: a new token).
 * - While held, a heartbeat (its own interval, independent of the scheduler
 *   tick) renews it. A refused renewal (expired, or taken over: token
 *   mismatch) marks it LOST at once; a renewal that errors keeps ownership
 *   only until the local deadline from the last confirmed renewal, then marks
 *   it lost. Loss is alerted. Ownership is never assumed after a failure.
 * - `holds(token)` is the stage-boundary check: still the same epoch, and
 *   within the local deadline.
 * - `release()` ends the lease (only this epoch's owner + token).
 */
export class OrchestratorLease {
  private token: string | null = null;
  private localDeadline = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private renewing = false;
  private epochs = 0;

  constructor(private readonly opts: {
    backend: LeaseBackend;
    ownerId: string;
    ttlMs?: number;
    heartbeatMs?: number;
    safetyMs?: number;
    /** Monotonic milliseconds (default performance.now); tests inject a fake. */
    monotonicNow?: () => number;
  }) {}

  get ownerId(): string { return this.opts.ownerId; }
  /** Ownership epochs acquired by this process so far. */
  get epochCount(): number { return this.epochs; }
  private get ttlMs(): number { return this.opts.ttlMs ?? TOURNAMENT_ORCHESTRATOR_LEASE_TTL_MS_DEFAULT; }
  /** The TTL the database is asked for, in whole seconds (what it grants). */
  private get ttlSeconds(): number { return Math.floor(this.ttlMs / 1000); }
  private now(): number { return (this.opts.monotonicNow ?? performance.now.bind(performance))(); }
  /** From the monotonic time the request was SENT, and the TTL actually granted. */
  private deadlineFrom(sentAt: number): number {
    return sentAt + this.ttlSeconds * 1000 - (this.opts.safetyMs ?? TOURNAMENT_ORCHESTRATOR_LEASE_SAFETY_MS);
  }

  /** Still the owner of epoch `token` (or of any epoch, without one), by the conservative local view. */
  holds(token?: string | null): boolean {
    if (this.token === null || this.now() >= this.localDeadline) return false;
    return token === undefined || token === this.token;
  }

  async ensure(): Promise<LeaseOwnership> {
    if (this.holds()) return { held: true, newEpoch: false, token: this.token };
    if (this.token !== null) this.markLost('local_deadline_passed');
    const sentAt = this.now();
    const r = await this.opts.backend.acquire(this.opts.ownerId, this.ttlSeconds);
    if (!r.acquired || !r.leaseToken) return { held: false, newEpoch: false, token: null };
    this.token = r.leaseToken;
    this.localDeadline = this.deadlineFrom(sentAt);
    this.epochs += 1;
    this.startHeartbeat();
    log.info({ owner: this.opts.ownerId, epoch: this.epochs }, 'orchestrator lease acquired');
    return { held: true, newEpoch: true, token: this.token };
  }

  /** One renewal now (the heartbeat's step; exposed for tests). */
  async renewNow(): Promise<void> {
    const token = this.token;
    if (token === null || this.renewing) return;
    this.renewing = true;
    const sentAt = this.now();
    try {
      const r = await this.opts.backend.renew(this.opts.ownerId, token, this.ttlSeconds);
      if (this.token !== token) return;
      if (r.renewed) this.localDeadline = this.deadlineFrom(sentAt);
      else this.markLost('renew_refused');
    } catch (err) {
      log.warn({ err, owner: this.opts.ownerId }, 'orchestrator lease renewal failed');
      if (this.token === token && this.now() >= this.localDeadline) this.markLost('renew_failed_past_deadline');
    } finally {
      this.renewing = false;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => { void this.renewNow(); }, this.opts.heartbeatMs ?? TOURNAMENT_ORCHESTRATOR_HEARTBEAT_MS_DEFAULT);
    this.heartbeat.unref?.();
  }

  stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private markLost(reason: string): void {
    if (this.token === null) return;
    this.token = null;
    this.stopHeartbeat();
    log.error({ owner: this.opts.ownerId, reason }, 'orchestrator lease lost');
    alertTournamentAnomaly('orchestrator_lease_lost', {}, { owner: this.opts.ownerId, reason });
  }

  /** End this epoch's lease (owner + token). Never touches a newer epoch. */
  async release(): Promise<boolean> {
    const token = this.token;
    this.stopHeartbeat();
    if (token === null || !this.holds(token)) {
      this.token = null;
      return false;
    }
    this.token = null;
    try {
      const r = await this.opts.backend.release(this.opts.ownerId, token);
      log.info({ owner: this.opts.ownerId, released: r.released }, 'orchestrator lease released');
      return r.released;
    } catch (err) {
      log.warn({ err }, 'orchestrator lease release failed; it expires by TTL');
      return false;
    }
  }
}
