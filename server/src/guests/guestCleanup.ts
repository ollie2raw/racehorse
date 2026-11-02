import { supabaseFetch } from '../supabaseUtils';
import { childLogger } from '../logger';
import { isProcessClosing, processInterval, processTimeout } from '../platform/processLifecycle';

const log = childLogger('guest-cleanup');

/**
 * Removes guest accounts that have been inactive for 30 days (docs/guest-play-design.md, "Guests are cleaned up"; the Privacy Policy says so).
 *
 * The work is one database function, `delete_inactive_guests` (supabase/migrations/2026-11-02_guest_play_g2b.sql). It can only ever touch a user who is
 * anonymous AND whose profile says guest, with nothing newer than the cutoff on their auth record, and deleting the auth user cascades to their rows. A
 * permanent account is never a candidate. This module only decides when to call it and how much to let it do.
 *
 * GUEST_CLEANUP_MODE:
 *   delete (default)  removes up to GUEST_CLEANUP_LIMIT inactive guests each run
 *   report            counts what WOULD be removed and logs it; deletes nothing
 *   off               does not run
 * Anything else is treated as report, so a typo can never delete.
 */
export type GuestCleanupMode = 'off' | 'report' | 'delete';

export const GUEST_INACTIVE_DAYS = 30;
export const GUEST_CLEANUP_LIMIT = 500;
export const GUEST_CLEANUP_INTERVAL_MS = 24 * 60 * 60_000;
export const GUEST_CLEANUP_BOOT_DELAY_MS = 5 * 60_000;

export function guestCleanupMode(setting: string | undefined = process.env.GUEST_CLEANUP_MODE): GuestCleanupMode {
  const raw = setting?.trim().toLowerCase();
  if (raw === undefined || raw === '' || raw === 'delete') return 'delete';
  if (raw === 'off') return 'off';
  return 'report';
}

/** The function returns a bare integer. Anything else (null, an object, an empty string) is not a count; Number(null) would read as 0. */
function asCount(result: unknown): number | null {
  if (typeof result === 'number') return Number.isFinite(result) ? result : null;
  if (typeof result === 'string' && /^\d+$/.test(result.trim())) return Number(result);
  return null;
}

export type GuestCleanupResult = { mode: GuestCleanupMode; count: number | null };

type RpcCaller = (path: string, init: { method: 'POST'; body: string }) => Promise<unknown>;

/** One run. Returns how many guests were (or would be) removed; null when it did not run or the call failed. Never throws. */
export async function runGuestCleanup(
  mode: GuestCleanupMode = guestCleanupMode(),
  call: RpcCaller = (path, init) => supabaseFetch(path, init),
): Promise<GuestCleanupResult> {
  if (mode === 'off') return { mode, count: null };
  try {
    const result = await call('/rest/v1/rpc/delete_inactive_guests', {
      method: 'POST',
      body: JSON.stringify({
        p_inactive_days: GUEST_INACTIVE_DAYS,
        p_limit: GUEST_CLEANUP_LIMIT,
        p_dry_run: mode !== 'delete',
      }),
    });
    const count = asCount(result);
    if (count === null) {
      log.warn({ mode }, 'guest cleanup returned something other than a count');
      return { mode, count: null };
    }
    if (count > 0 || mode === 'report') {
      log.info({ mode, count, inactiveDays: GUEST_INACTIVE_DAYS }, mode === 'delete' ? 'removed inactive guest accounts' : 'inactive guest accounts that would be removed');
    }
    // A full batch means more are waiting; the next daily run takes them.
    if (mode === 'delete' && count >= GUEST_CLEANUP_LIMIT) log.warn({ count }, 'guest cleanup hit its per-run limit; the rest wait for the next run');
    return { mode, count };
  } catch (err) {
    log.warn({ err, mode }, 'guest cleanup failed (is the G2b migration applied?)');
    return { mode, count: null };
  }
}

let scheduled = false;

/** Boot run, then daily. Safe to call once at server start. */
export function scheduleGuestCleanup(): void {
  if (scheduled) return;
  const mode = guestCleanupMode();
  if (mode === 'off') {
    log.info('guest cleanup DISABLED (GUEST_CLEANUP_MODE=off)');
    return;
  }
  scheduled = true;
  const run = (): Promise<GuestCleanupResult> | undefined => (isProcessClosing() ? undefined : runGuestCleanup(mode));
  processTimeout('guest-cleanup', run, GUEST_CLEANUP_BOOT_DELAY_MS).unref?.();
  processInterval('guest-cleanup', run, GUEST_CLEANUP_INTERVAL_MS).unref?.();
  log.info({ mode, inactiveDays: GUEST_INACTIVE_DAYS, limit: GUEST_CLEANUP_LIMIT }, 'guest cleanup scheduled (boot + daily)');
}

/** Test-only. */
export function resetGuestCleanupForTests(): void {
  scheduled = false;
}
