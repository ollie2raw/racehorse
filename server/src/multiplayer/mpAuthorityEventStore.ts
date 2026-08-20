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

let persistChain: Promise<void> = Promise.resolve();

export function queueMpAuthorityEventPersist(row: MpAuthorityEventRecord): void {
  persistChain = persistChain.then(() => recordMpAuthorityEventBestEffort(row));
}

export async function flushMpAuthorityEventPersistForTests(): Promise<void> {
  await persistChain;
}
