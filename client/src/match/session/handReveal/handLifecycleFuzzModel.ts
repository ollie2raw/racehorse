/**
 * The pieces of the hand lifecycle fuzzer that are not the world itself: a seeded RNG, a virtual clock, the message types between the modelled
 * server and client, the scenario options and the time bounds the properties use. See handLifecycleFuzz.test.ts for the model and the properties.
 */
import { TOURNAMENT_VIEW_DESYNC_GRACE_MS } from '../../../tournament/tournamentViewDesyncMachine';

// ── the virtual clock ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Scheduled = { at: number; order: number; id: number; tag: string; run: () => void };

export class Clock {
  now = 0;
  private queue: Scheduled[] = [];
  private cancelled = new Set<number>();
  private nextId = 1;
  private order = 0;

  after(delayMs: number, tag: string, run: () => void): number {
    const id = this.nextId++;
    this.queue.push({ at: this.now + Math.max(0, delayMs), order: this.order++, id, tag, run });
    return id;
  }

  cancel(id: number | null): void {
    if (id !== null) this.cancelled.add(id);
  }

  /** Runs the next event; false when nothing is left. */
  step(): boolean {
    for (;;) {
      if (this.queue.length === 0) return false;
      let best = 0;
      for (let i = 1; i < this.queue.length; i++) {
        const a = this.queue[i];
        const b = this.queue[best];
        if (a.at < b.at || (a.at === b.at && a.order < b.order)) best = i;
      }
      const next = this.queue.splice(best, 1)[0];
      if (this.cancelled.delete(next.id)) continue;
      this.now = next.at;
      next.run();
      return true;
    }
  }
}

// ── the model ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Seat = 'you' | 'fritz';
export type StateMsg = { seq: number; handNumber: number; handOver: boolean; gameOver: boolean; turn: Seat };
export type ClockMsg = { kind: 'turn'; deadline: number } | { kind: 'next_hand'; deadline: number } | null;
export type ServerMsg =
  | { type: 'state'; state: StateMsg }
  | { type: 'handEnded'; handNumber: number }
  | { type: 'clock'; clock: ClockMsg }
  | { type: 'joinAck'; state: StateMsg; clock: ClockMsg; clearsReveal: boolean }
  | { type: 'ack'; id: number };
export type ClientMsg = { type: 'ready'; handNumber: number | undefined; ackId: number } | { type: 'move'; seq: number } | { type: 'resync'; clearsReveal: boolean };

export type Violation = { property: string; at: number; detail: string };

export type FuzzOptions = {
  /** Probability that a state broadcast is delivered twice (the optimistic-apply echo). */
  echoRate: number;
  /** Mean milliseconds between disconnects (0: none). */
  disconnectEveryMs: number;
  /** Whether a reconnect clears the reveal on screen (the real reconnect path resets the shell UI; not confirmed for every path). */
  reconnectClearsReveal: number;
  /** Probability that the client silently drops a state update with no follow-up fetch (a projection gate with no fetch reason). */
  silentDropRate: number;
  /** Probability that the player taps Continue rather than waiting for the countdown. */
  tapRate: number;
};

export const DEFAULT_OPTIONS: FuzzOptions = {
  echoRate: 0.2,
  disconnectEveryMs: 25_000,
  reconnectClearsReveal: 0.7,
  silentDropRate: 0,
  tapRate: 0.6,
};

export const NEXT_HAND_CLOCK_MS = 45_000;
export const READY_GATE_MS = 2_500;
export const FRITZ_READY_MS = 800;
export const TURN_CLOCK_MS = 45_000;
/** How long the clock may name the player while the view does not: the grace, a round trip for the resync, and slack. */
export const DESYNC_BOUND_MS = TOURNAMENT_VIEW_DESYNC_GRACE_MS + 1_500;
/** The normal path is the reveal opening and its countdown (about 5.5 s); a person taking longer than this is not a bug but the machine never sending is. */
export const READY_BOUND_MS = 12_000;
/** emitWithAck rejects after this long with no ack (roomTransport.ts SOCKET_ACK_TIMEOUT_MS). */
export const ACK_TIMEOUT_MS = 8_000;
