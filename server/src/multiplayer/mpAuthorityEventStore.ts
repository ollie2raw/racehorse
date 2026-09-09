import { supabaseFetch } from '../supabaseUtils';
import { childLogger } from '../logger';
import type {
  MpAuthorityFailureCode,
  MpAuthorityFunnelEvent,
  MpAuthoritySourceType,
} from './mpAuthorityTelemetry';

const log = childLogger('mp-authority-events');

export const MP_AUTHORITY_EVENT_WRITE_TIMEOUT_MS = 2_500;

export type MpAuthorityEventRecord = {
  event: MpAuthorityFunnelEvent;
  ts: string;
  roomCode: string | null;
  seatId: string | null;
  requestId: string | null;
  failureCode: MpAuthorityFailureCode | null;
  sourceType: MpAuthoritySourceType | null;
  payload: Record<string, unknown>;
};

export type MpAuthorityFunnelMetricRow = {
  eventDate: string;
  event: string;
  total: number;
};

/** Calendar date in America/Los_Angeles, matching mp_authority_funnel_metrics. */
export function pacificEventDate(ts: string | Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ts));
}

export function groupMpAuthorityFunnelMetrics(
  rows: Array<{ event: string; ts: string }>,
): MpAuthorityFunnelMetricRow[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = `${pacificEventDate(row.ts)}\0${row.event}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, total]) => {
      const [eventDate, event] = key.split('\0');
      return { eventDate, event, total };
    })
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.event.localeCompare(b.event));
}

export async function recordMpAuthorityEvent(row: MpAuthorityEventRecord): Promise<void> {
  await supabaseFetch('/rest/v1/mp_authority_events', {
    method: 'POST',
    headers: {
      Prefer: 'return=minimal',
    },
    timeoutMs: MP_AUTHORITY_EVENT_WRITE_TIMEOUT_MS,
    body: JSON.stringify([{
      event: row.event,
      ts: row.ts,
      room_code: row.roomCode,
      seat_id: row.seatId,
      request_id: row.requestId,
      failure_code: row.failureCode,
      source_type: row.sourceType,
      payload: row.payload,
    }]),
  });
}

export async function recordMpAuthorityEventBestEffort(row: MpAuthorityEventRecord): Promise<void> {
  try {
    await recordMpAuthorityEvent(row);
  } catch (error) {
    log.warn({
      event: row.event,
      roomCode: row.roomCode,
      error: error instanceof Error ? error.message : String(error),
    }, '[mp.authority] persistence failed');
  }
}

/**
 * How many `private_move_log_verification_failed` events one user has produced in
 * the trailing window. Counts only rows whose `payload.userId` matches — so it
 * accumulates from the point that field started being written (like DF-G2's
 * `countRecentDailyFritzVerificationFailures`). Used to escalate the Sentry
 * alert from `warning` to `error` for a repeat pattern (a tamper signal, not a
 * verifier edge case). Best-effort — returns 0 on any failure.
 */
export async function countRecentMoveLogVerificationFailuresForUser(
  userId: string,
  options: { days?: number; cap?: number } = {},
): Promise<number> {
  if (!userId) return 0;
  const days = Math.max(1, Math.min(90, Math.floor(options.days ?? 7)));
  const cap = Math.max(1, Math.min(200, Math.floor(options.cap ?? 50)));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  try {
    const rows = await supabaseFetch<Array<{ id: string }>>(
      `/rest/v1/mp_authority_events?select=id` +
        `&event=eq.private_move_log_verification_failed` +
        `&payload->>userId=eq.${encodeURIComponent(userId)}` +
        `&ts=gte.${encodeURIComponent(since)}&limit=${cap}`,
      { method: 'GET', timeoutMs: 2_500, circuitBreakable: true },
    );
    return Array.isArray(rows) ? rows.length : 0;
  } catch {
    return 0;
  }
}

export async function queryMpAuthorityFunnelMetrics(): Promise<MpAuthorityFunnelMetricRow[]> {
  const rows = await supabaseFetch<Array<Record<string, unknown>>>(
    '/rest/v1/mp_authority_funnel_metrics?select=event_date,event,total',
    { method: 'GET' },
  );
  return rows.map((row) => ({
    eventDate: String(row.event_date),
    event: String(row.event),
    total: Number(row.total) || 0,
  }));
}

const pendingPersists = new Set<Promise<void>>();

export function queueMpAuthorityEventPersist(row: MpAuthorityEventRecord): void {
  const pending = recordMpAuthorityEventBestEffort(row).finally(() => {
    pendingPersists.delete(pending);
  });
  pendingPersists.add(pending);
}

export async function flushMpAuthorityEventPersistForTests(): Promise<void> {
  await Promise.all([...pendingPersists]);
}
