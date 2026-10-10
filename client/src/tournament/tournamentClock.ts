/**
 * The tournament client's estimate of server time (Phase 3C). Every tournament
 * countdown reads it; no screen computes an offset itself.
 *
 * Model: `performance.now()` (monotonic, this page's lifetime) mapped to the
 * server's epoch by one offset. A request sample takes the server's
 * `serverNow` as the time at the midpoint of the round trip:
 *
 *   offset = serverNow - (sendMono + receiveMono) / 2
 *   estimatedServerNow = performance.now() + offset
 *
 * The device clock (Date.now) is never the authority: changing it does not
 * move the estimate. Before any sample exists the device clock is the
 * fallback (the first tournament request replaces it).
 *
 * Sample choice: the lowest round trip wins, until it is older than
 * SAMPLE_MAX_AGE_MS — then any newer request sample replaces it. A one-way
 * socket `serverNow` (delay unknown, so it reads early) is used only while
 * no request sample is fresh, and never moves the estimate backward.
 *
 * Display only: server status decides every tournament lifecycle step.
 */

export const SAMPLE_MAX_AGE_MS = 60_000;
/** A socket sample is ignored while a request sample is younger than this. */
export const SOCKET_SAMPLE_GRACE_MS = 2 * 60_000;

type Sample = { offsetMs: number; rttMs: number; atMono: number; source: 'request' | 'socket' };

let sample: Sample | null = null;
let monotonicSource: () => number = () => performance.now();
const listeners = new Set<() => void>();

export function monotonicNow(): number {
  return monotonicSource();
}

function parseServerNow(serverNow: unknown): number | null {
  if (typeof serverNow !== 'string') return null;
  const ms = Date.parse(serverNow);
  return Number.isFinite(ms) ? ms : null;
}

function setSample(next: Sample): void {
  sample = next;
  for (const listener of listeners) listener();
}

/** Record a request/response pair (monotonic send and receive times, the response's serverNow). */
export function observeTournamentRequest(sendMono: number, receiveMono: number, serverNow: unknown): void {
  const serverMs = parseServerNow(serverNow);
  if (serverMs === null || receiveMono < sendMono) return;
  const rttMs = receiveMono - sendMono;
  const next: Sample = { offsetMs: serverMs - (sendMono + receiveMono) / 2, rttMs, atMono: receiveMono, source: 'request' };
  const current = sample;
  if (
    !current ||
    current.source === 'socket' ||
    rttMs <= current.rttMs ||
    receiveMono - current.atMono > SAMPLE_MAX_AGE_MS
  ) {
    setSample(next);
  }
}

/** Record a one-way socket push's serverNow (lower confidence). */
export function observeTournamentPush(serverNow: unknown, receiveMono: number = monotonicNow()): void {
  const serverMs = parseServerNow(serverNow);
  if (serverMs === null) return;
  const offsetMs = serverMs - receiveMono;
  const current = sample;
  if (current && current.source === 'request' && receiveMono - current.atMono < SOCKET_SAMPLE_GRACE_MS) return;
  if (current && offsetMs < current.offsetMs) return;
  setSample({ offsetMs, rttMs: Number.POSITIVE_INFINITY, atMono: receiveMono, source: 'socket' });
}

/** Estimated server time (epoch ms). */
export function estimatedServerNowMs(): number {
  return sample ? monotonicNow() + sample.offsetMs : Date.now();
}

export function hasTournamentServerClock(): boolean {
  return sample !== null;
}

/** Notified when the estimate's sample changes (for useSyncExternalStore). */
export function subscribeTournamentClock(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Milliseconds until `targetIso` by the server clock, clamped at zero; null for a missing/invalid time. */
export function msUntil(targetIso: string | null | undefined, nowMs: number = estimatedServerNowMs()): number | null {
  if (!targetIso) return null;
  const target = Date.parse(targetIso);
  if (!Number.isFinite(target)) return null;
  return Math.max(0, target - nowMs);
}

/** Tests only. */
export function resetTournamentClockForTests(source?: () => number): void {
  sample = null;
  monotonicSource = source ?? (() => performance.now());
  listeners.clear();
}
