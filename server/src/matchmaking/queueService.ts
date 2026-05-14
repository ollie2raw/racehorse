import type { MatchedPair, QueuedPlayer, QueueStatusEvent } from './types';
import { findPairs, ratingWindowMsAt } from './pairing';

export type QueueServiceOptions = {
  onMatched: (a: QueuedPlayer, b: QueuedPlayer) => void;
  onTimeout: (socketId: string) => void;
  tickIntervalMs?: number;
  timeoutAfterMs?: number;
};

export type JoinInput = Omit<QueuedPlayer, 'joinedAtMs'>;

export type JoinResult =
  | { ok: true; player: QueuedPlayer }
  | { ok: false; reason: 'already_queued' };

/**
 * In-memory matchmaking queue. Single instance per server process.
 *
 * Lifecycle:
 *   const svc = new QueueService({ onMatched, onTimeout });
 *   svc.start();   // begins the 1s sweep
 *   svc.join({ socketId, userId, username, rating, isSim });
 *   svc.leave(socketId);
 *   svc.stop();    // tests should always call this in afterEach
 */
export class QueueService {
  private players = new Map<string, QueuedPlayer>(); // by socketId
  private byUserId = new Map<string, string>();      // userId -> socketId
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly opts: Required<QueueServiceOptions>;

  constructor(opts: QueueServiceOptions) {
    this.opts = {
      tickIntervalMs: opts.tickIntervalMs ?? 1000,
      timeoutAfterMs: opts.timeoutAfterMs ?? 90_000,
      onMatched: opts.onMatched,
      onTimeout: opts.onTimeout,
    };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.opts.tickIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  size(): number {
    return this.players.size;
  }

  list(): QueuedPlayer[] {
    return Array.from(this.players.values());
  }

  join(input: JoinInput): JoinResult {
    if (this.byUserId.has(input.userId)) {
      return { ok: false, reason: 'already_queued' };
    }
    const player: QueuedPlayer = { ...input, joinedAtMs: Date.now() };
    this.players.set(player.socketId, player);
    this.byUserId.set(player.userId, player.socketId);
    return { ok: true, player };
  }

  leave(socketId: string): boolean {
    const p = this.players.get(socketId);
    if (!p) return false;
    this.players.delete(socketId);
    this.byUserId.delete(p.userId);
    return true;
  }

  getStatus(socketId: string): QueueStatusEvent | null {
    const p = this.players.get(socketId);
    if (!p) return null;
    const elapsedMs = Date.now() - p.joinedAtMs;
    return {
      state: 'searching',
      elapsedMs,
      windowWidth: ratingWindowMsAt(elapsedMs),
      queueSize: this.players.size,
    };
  }

  /** Exposed for test-driving; production code calls this on the interval. */
  tick(): void {
    const now = Date.now();
    const players = Array.from(this.players.values());
    const pairs: MatchedPair[] = findPairs(players, now);
    for (const pair of pairs) {
      this.leave(pair.a.socketId);
      this.leave(pair.b.socketId);
      this.opts.onMatched(pair.a, pair.b);
    }
    // Timeout players who have waited past the threshold and have not yet been matched.
    const stragglers = Array.from(this.players.values());
    for (const p of stragglers) {
      if (now - p.joinedAtMs >= this.opts.timeoutAfterMs) {
        this.leave(p.socketId);
        this.opts.onTimeout(p.socketId);
      }
    }
  }
}
