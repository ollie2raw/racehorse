/**
 * Shared hand-over → next-hand lifecycle helpers for bot / Daily Fritz matches.
 * Keeps transition rules explicit and testable.
 */

export type HandLifecyclePhase =
  | 'playing'
  | 'resolving-hand'
  | 'showing-hand-result'
  | 'advancing-hand'
  | 'dealing-next-hand'
  | 'playing-next-hand'
  | 'set-complete'
  | 'match-complete'
  | 'error';

export type HandLifecycleLogPayload = {
  phase: HandLifecyclePhase;
  previousPhase?: HandLifecyclePhase;
  mode?: string;
  handNumber?: number;
  detail?: Record<string, unknown>;
  hypothesisId?: string;
};

const DEV =
  typeof import.meta !== 'undefined' &&
  (import.meta as ImportMeta & { env?: { DEV?: boolean; VITE_DEBUG_HAND_LIFECYCLE?: string } }).env?.DEV === true;

let lastPhase: HandLifecyclePhase = 'playing';

export function resetHandLifecyclePhase(): void {
  lastPhase = 'playing';
}

export function getHandLifecyclePhase(): HandLifecyclePhase {
  return lastPhase;
}

/** True when local state should accept a dealt next hand. */
export function canApplyNextHand(match: { handOver: boolean; gameOver: boolean }): boolean {
  return match.handOver && !match.gameOver;
}

export function logHandLifecycle(payload: HandLifecycleLogPayload): void {
  const previousPhase = payload.previousPhase ?? lastPhase;
  lastPhase = payload.phase;
  if (DEV) {
    const suffix = payload.detail ? ` ${JSON.stringify(payload.detail)}` : '';
    console.log(`[handLifecycle] ${previousPhase} -> ${payload.phase}${suffix}`);
  }
}

export function warnHandLifecycleStuck(
  message: string,
  detail: Record<string, unknown>,
): void {
  if (DEV) {
    console.warn(`[handLifecycle] STUCK: ${message}`, detail);
  }
}

/** Debug-session ingest (no-op in production). */
export type DailyFritzNextHandCache<T> = {
  promise: Promise<T>;
  result: T | null;
  error: unknown;
  startedAt: number;
};

/** Prefer settled prefetch; otherwise await in-flight; otherwise create. */
export async function resolveDailyFritzNextHandCache<T>(
  cache: DailyFritzNextHandCache<T> | null,
  createRequest: () => Promise<T>,
): Promise<T> {
  if (cache?.result) return cache.result;
  if (cache?.promise) {
    // A rejected prefetch (or any failed attempt) leaves `error` set and the
    // same rejected promise on the cache. Retrying must issue a fresh fetch —
    // the server path is idempotent (replayed/ignored responses).
    if (cache.error) return createRequest();
    try {
      return await cache.promise;
    } catch {
      return createRequest();
    }
  }
  return createRequest();
}

export function emitHandLifecycleDebugLog(
  sessionId: string,
  endpoint: string,
  payload: {
    location: string;
    message: string;
    hypothesisId?: string;
    data?: Record<string, unknown>;
    runId?: string;
  },
): void {
  const env = (import.meta as ImportMeta & {
    env?: { VITE_DEBUG_HAND_LIFECYCLE?: string; VITE_DEBUG_DAILY_FRITZ?: string };
  }).env;
  if (!DEV && env?.VITE_DEBUG_HAND_LIFECYCLE !== 'true' && env?.VITE_DEBUG_DAILY_FRITZ !== 'true') return;
  fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': sessionId,
    },
    body: JSON.stringify({
      sessionId,
      timestamp: Date.now(),
      ...payload,
    }),
  }).catch(() => {});
}
