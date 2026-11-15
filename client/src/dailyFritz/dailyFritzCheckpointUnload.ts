import { readE2eDevAuth } from '../auth/e2eDevAuth';
import { resolveGameServerUrl } from '../lib/gameServerUrl';
import { createDailyFritzRequestId, DAILY_FRITZ_REQUEST_ID_HEADER } from './dailyFritzRequestIds';

/**
 * Mid-hand checkpoint POST window (hand/game end posts immediately; hiding the tab, pagehide and leaving the screen flush
 * what is pending). A reload or crash can lose at most this much mid-hand progress, and the local snapshot, which is
 * written on every change, still restores it on the same device. Rollback: set this back to 600.
 */
export const DAILY_FRITZ_CHECKPOINT_SYNC_DEBOUNCE_MS = 12_000;

/** A failed post is retried after each of these delays, then left pending for the next flush or state change. */
export const DAILY_FRITZ_CHECKPOINT_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 15_000];

export type FlushDailyFritzCheckpointOnUnloadInput = {
  attemptId: string;
  verifiedMatchId: string;
  checkpoint: Record<string, unknown>;
  accessToken?: string | null;
  e2eUserId?: string | null;
};

/**
 * Best-effort checkpoint flush during page teardown. Prefer sendBeacon (survives
 * unload); fall back to keepalive fetch when beacon is unavailable.
 *
 * sendBeacon cannot set Authorization headers, so access_token is included in
 * the JSON body when needed (server accepts it as a fallback).
 */
export function flushDailyFritzCheckpointOnUnload(
  input: FlushDailyFritzCheckpointOnUnloadInput,
): boolean {
  if (typeof window === 'undefined') return false;

  const e2e = readE2eDevAuth();
  const accessToken = input.accessToken ?? e2e?.token ?? null;
  const e2eUserId = input.e2eUserId ?? e2e?.user.id ?? null;
  const requestId = createDailyFritzRequestId();
  const url = `${resolveGameServerUrl()}/api/daily-fritz/checkpoint`;
  const payload = JSON.stringify({
    attempt_id: input.attemptId,
    verified_match_id: input.verifiedMatchId,
    checkpoint: input.checkpoint,
    ...(accessToken ? { access_token: accessToken } : {}),
  });

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    return navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
  }

  if (typeof fetch !== 'undefined') {
    void fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(e2eUserId ? { 'x-e2e-daily-fritz-user': e2eUserId } : {}),
        [DAILY_FRITZ_REQUEST_ID_HEADER]: requestId,
      },
      body: payload,
      keepalive: true,
      credentials: 'include',
    });
    return true;
  }

  return false;
}
