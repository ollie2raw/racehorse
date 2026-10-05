import { childLogger } from '../logger';
import { listRoomCodes } from '../rooms';
import { supabaseFetch } from '../supabaseUtils';

const log = childLogger('room-retention');

/**
 * Daily retention for room rows that nothing will ever read again
 * (docs/ops/hosting-cost-plan.md §4, PR S3).
 *
 * - `room_live_sessions` rows not updated for 7 days. A live room rewrites its
 *   row on every move and is cleaned up from memory long before a week of
 *   silence, so these are leftovers: on 2026-10-04 there were 5,986 rows stuck
 *   in `playing` and 215 in `lobby`, growing ~15 MB a month. Any room this
 *   process still holds in memory is excluded, whatever its `updated_at`.
 * - `room_match_logs` for abandoned games with no signed-in participant
 *   (guest-only), archived more than 30 days ago. No player can open them.
 *
 * One timer, one run a day, two indexed DELETEs: they show up in the hourly
 * usage log as `DELETE room_live_sessions` / `DELETE room_match_logs`.
 * On unless ROOM_RETENTION_REAPER_ENABLED is exactly "false".
 */
export const ROOM_LIVE_SESSION_RETENTION_MS = 7 * 24 * 60 * 60_000;
export const GUEST_ABANDONED_MATCH_LOG_RETENTION_MS = 30 * 24 * 60 * 60_000;
export const ROOM_RETENTION_INTERVAL_MS = 24 * 60 * 60_000;
export const ROOM_RETENTION_BOOT_DELAY_MS = 10 * 60_000;
/**
 * Above this many in-memory rooms the exclusion list would make the DELETE URL
 * too long; that run skips `room_live_sessions` rather than drop the guard.
 */
export const ROOM_RETENTION_MAX_EXCLUDED_ROOMS = 300;

export function isRoomRetentionReaperEnabled(): boolean {
  return process.env.ROOM_RETENTION_REAPER_ENABLED !== 'false';
}

export type RoomRetentionResult = {
  liveSessionsDeleted: number | null;
  guestMatchLogsDeleted: number | null;
};

type DeletedRow = { room_code: string };

function liveSessionsPath(cutoffIso: string, liveRoomCodes: string[]): string {
  const params = new URLSearchParams({ updated_at: `lt.${cutoffIso}`, select: 'room_code' });
  if (liveRoomCodes.length > 0) {
    params.set('room_code', `not.in.(${liveRoomCodes.map((code) => `"${code}"`).join(',')})`);
  }
  return `/rest/v1/room_live_sessions?${params.toString()}`;
}

function guestMatchLogsPath(cutoffIso: string): string {
  const params = new URLSearchParams({
    status: 'eq.abandoned',
    participant_user_ids: 'eq.{}',
    archived_at: `lt.${cutoffIso}`,
    select: 'room_code',
  });
  return `/rest/v1/room_match_logs?${params.toString()}`;
}

export async function runRoomRetention(nowMs = Date.now()): Promise<RoomRetentionResult> {
  const result: RoomRetentionResult = { liveSessionsDeleted: null, guestMatchLogsDeleted: null };

  const liveRoomCodes = listRoomCodes();
  if (liveRoomCodes.length > ROOM_RETENTION_MAX_EXCLUDED_ROOMS) {
    log.warn({ liveRooms: liveRoomCodes.length }, 'too many rooms in memory to exclude; skipping live-session retention this run');
  } else {
    try {
      const cutoff = new Date(nowMs - ROOM_LIVE_SESSION_RETENTION_MS).toISOString();
      const deleted = await supabaseFetch<DeletedRow[] | null>(liveSessionsPath(cutoff, liveRoomCodes), { method: 'DELETE' });
      result.liveSessionsDeleted = deleted?.length ?? 0;
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : err }, 'live-session retention failed');
    }
  }

  try {
    const cutoff = new Date(nowMs - GUEST_ABANDONED_MATCH_LOG_RETENTION_MS).toISOString();
    const deleted = await supabaseFetch<DeletedRow[] | null>(guestMatchLogsPath(cutoff), { method: 'DELETE' });
    result.guestMatchLogsDeleted = deleted?.length ?? 0;
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err }, 'guest match-log retention failed');
  }

  log.info(result, 'room retention run');
  return result;
}

let bootTimer: ReturnType<typeof setTimeout> | null = null;
let intervalTimer: ReturnType<typeof setInterval> | null = null;

export function scheduleRoomRetention(): void {
  if (bootTimer || intervalTimer) return;
  if (!isRoomRetentionReaperEnabled()) {
    log.info('room retention DISABLED (ROOM_RETENTION_REAPER_ENABLED=false)');
    return;
  }
  bootTimer = setTimeout(() => {
    bootTimer = null;
    void runRoomRetention();
    intervalTimer = setInterval(() => { void runRoomRetention(); }, ROOM_RETENTION_INTERVAL_MS);
    intervalTimer.unref?.();
  }, ROOM_RETENTION_BOOT_DELAY_MS);
  bootTimer.unref?.();
}

/** Test-only. */
export function resetRoomRetentionForTests(): void {
  if (bootTimer) clearTimeout(bootTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  bootTimer = null;
  intervalTimer = null;
}
