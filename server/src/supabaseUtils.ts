
import * as Sentry from '@sentry/node';
import { config } from './config';
import { childLogger } from './logger';

const log = childLogger('supabase');

/** Prevent hung PostgREST/auth calls from blocking HTTP handlers indefinitely. */
export const DEFAULT_SUPABASE_FETCH_TIMEOUT_MS = 15_000;

function requireEnv(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function getConfig() {
  return {
    supabaseUrl: config.supabasePoolerUrl || requireEnv('SUPABASE_URL', config.supabaseUrl),
    serviceKey: requireEnv('SUPABASE_SERVICE_KEY', config.supabaseServiceKey),
  };
}

export function isSupabaseTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError') return true;
  return /timed out|aborted/i.test(error.message);
}

export type SupabaseFetchOptions = RequestInit & {
  timeoutMs?: number;
  /** Mark as a non-critical read so the circuit breaker may short-circuit it. */
  circuitBreakable?: boolean;
};

// ---------------------------------------------------------------------------
// 3.2 — Circuit breaker for non-critical supabase reads
// ---------------------------------------------------------------------------

/** Failure timestamps within the current window. */
const failureTimestamps: number[] = [];
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_WINDOW_MS = 10_000;
const CIRCUIT_OPEN_DURATION_MS = 30_000;

let circuitOpenUntil = 0;

/** Exposed for tests only. Resets all circuit breaker state. */
export function resetCircuitBreaker(): void {
  failureTimestamps.length = 0;
  circuitOpenUntil = 0;
}

/** Returns true when the breaker is currently open (failing fast). */
export function isCircuitOpen(now = Date.now()): boolean {
  return now < circuitOpenUntil;
}

function recordFailure(now = Date.now()): void {
  // Prune timestamps outside the sliding window
  const windowStart = now - CIRCUIT_WINDOW_MS;
  while (failureTimestamps.length > 0 && failureTimestamps[0]! <= windowStart) {
    failureTimestamps.shift();
  }
  failureTimestamps.push(now);
  if (failureTimestamps.length >= CIRCUIT_FAILURE_THRESHOLD) {
    circuitOpenUntil = now + CIRCUIT_OPEN_DURATION_MS;
    Sentry.withScope((scope) => {
      scope.setTag('subsystem', 'supabase_circuit_breaker');
      scope.setContext('circuit_breaker', {
        failures: failureTimestamps.length,
        openUntil: new Date(circuitOpenUntil).toISOString(),
      });
      Sentry.captureException(new Error('Supabase circuit breaker opened'));
    });
    log.error(
      { failures: failureTimestamps.length, windowMs: CIRCUIT_WINDOW_MS },
      'supabase circuit breaker opened — failing fast for 30s',
    );
  }
}

// ---------------------------------------------------------------------------
// 3.1 — Timing wrapper emitting Sentry performance spans
// ---------------------------------------------------------------------------

async function runWithSpan<T>(
  path: string,
  method: string,
  fn: () => Promise<T>,
): Promise<T> {
  const startMs = Date.now();
  let failed = false;
  try {
    const result = await Sentry.startSpan(
      {
        name: `supabase.${method.toLowerCase()}`,
        op: 'db.query',
        attributes: { path, method },
      },
      () => fn(),
    );
    return result;
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    const durationMs = Date.now() - startMs;
    // Always emit a timing log so slow calls are visible even without Sentry tracing enabled.
    if (durationMs > 1000 || failed) {
      log.warn({ path, method, durationMs, failed }, 'supabase slow/failed query');
    }
  }
}

// ---------------------------------------------------------------------------
// Core fetch
// ---------------------------------------------------------------------------

export async function supabaseFetch<T>(path: string, init?: SupabaseFetchOptions): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const isReadRequest = method === 'GET' || method === 'HEAD';

  // Circuit breaker: only short-circuit non-critical reads to avoid blocking writes.
  if (isReadRequest && init?.circuitBreakable && isCircuitOpen()) {
    throw new Error(`Supabase circuit breaker is open — skipping read: ${path}`);
  }

  return runWithSpan(path, method, async () => {
    const { supabaseUrl, serviceKey } = getConfig();
    const { timeoutMs = DEFAULT_SUPABASE_FETCH_TIMEOUT_MS, circuitBreakable: _, ...requestInit } = init ?? {};
    const url = new URL(path, supabaseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        ...requestInit,
        signal: controller.signal,
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
          ...(requestInit.headers ?? {}),
        },
      });
    } catch (error) {
      if (isReadRequest && init?.circuitBreakable) recordFailure();
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Supabase request timed out after ${timeoutMs}ms: ${path}`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      if (isReadRequest && init?.circuitBreakable) recordFailure();
      throw new Error(`Supabase request failed: ${response.status} ${await response.text()}`);
    }

    const text = await response.text();
    if (!text.trim()) {
      return undefined as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new Error(
        `Supabase response JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}
