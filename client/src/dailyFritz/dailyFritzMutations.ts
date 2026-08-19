import { apiPost, type ApiResult } from '../api/client';
import { createDailyFritzRequestId, DAILY_FRITZ_REQUEST_ID_HEADER } from './dailyFritzRequestIds';

function dfClientDebug(..._args: unknown[]): void {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug(..._args);
  }
}

/** Init/today/start requests — 8–12s window before the UI leaves infinite loading. */
export const DAILY_FRITZ_INIT_TIMEOUT_MS = 10_000;

/** Next-hand advance (prefetch + reveal auto-advance). Match init — Render cold starts can exceed 4.5s. */
export const DAILY_FRITZ_NEXT_HAND_TIMEOUT_MS = 10_000;

/** Record-game must never strand the player on the Saving… overlay. */
export const DAILY_FRITZ_RECORD_GAME_TIMEOUT_MS = 15_000;

export const DAILY_FRITZ_COMPLETE_TIMEOUT_MS = 15_000;

export const DAILY_FRITZ_CHECKPOINT_TIMEOUT_MS = 8_000;

export type DailyFritzMutationFailureKind = 'timeout' | 'network' | 'authority' | 'server';

export function classifyDailyFritzMutationFailure(
  result: ApiResult<unknown>,
  timedOut: boolean,
): DailyFritzMutationFailureKind {
  if (timedOut || result.status === 408) return 'timeout';
  if (result.status === 401 || result.status === 403) return 'authority';
  if (result.status != null && result.status >= 500) return 'server';
  if (result.error?.toLowerCase().includes('timed out')) return 'timeout';
  return 'network';
}

export function throwApiResult<T>(result: ApiResult<T>): T {
  if (result.error) throw new Error(result.error);
  return result.data as T;
}

export async function timedDailyFritzMutationPost<T>(
  path: string,
  body: unknown,
  timeoutMs?: number,
): Promise<ApiResult<T>> {
  const start = performance.now();
  const controller = typeof AbortController !== 'undefined' && timeoutMs != null ? new AbortController() : null;
  let timedOut = false;
  const timeoutId = controller && timeoutMs != null
    ? window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs)
    : null;
  try {
    const result = await apiPost<T>(path, body, {
      headers: { [DAILY_FRITZ_REQUEST_ID_HEADER]: createDailyFritzRequestId() },
      signal: controller?.signal,
    });
    dfClientDebug('[daily-fritz-client] mutation', {
      path,
      ms: Number((performance.now() - start).toFixed(1)),
      ok: result.error === null,
      status: result.status,
      failureKind: result.error ? classifyDailyFritzMutationFailure(result, timedOut) : null,
    });
    if (timedOut && result.error) {
      return {
        ...result,
        error: 'Daily Fritz request timed out. Check your connection and try again.',
        status: result.status ?? 408,
      };
    }
    return result;
  } catch (error) {
    if (timedOut) {
      return {
        data: null,
        error: 'Daily Fritz request timed out. Check your connection and try again.',
        status: 408,
      };
    }
    throw error;
  } finally {
    if (timeoutId != null) window.clearTimeout(timeoutId);
  }
}
