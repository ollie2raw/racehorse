import { supabaseFetch } from '../../supabaseUtils';
import {
  DAILY_FRITZ_TELEMETRY_VERSION,
  classifyDailyFritzFailure,
  type DailyFritzEventType,
  type DailyFritzFailurePhase,
  type DailyFritzRecoveryClass,
} from '../../dailyFritzTelemetry';
import { isDailyFritzTransactionalAuthorityEnabled } from '../../dailyFritzAuthorityFeature';

export type { DailyFritzEventType } from '../../dailyFritzTelemetry';

export const DAILY_FRITZ_EVENT_WRITE_TIMEOUT_MS = 2_500;

let dailyFritzEventsPersistenceAvailable: boolean | null = null;

export type DailyFritzEventInput = {
  attemptId?: string | null;
  runDate?: string | null;
  userId?: string | null;
  requestId?: string | null;
  eventType: DailyFritzEventType;
  gameNumber?: number | null;
  handIndex?: number | null;
  statusCode?: number | null;
  verifierCode?: string | null;
  transcriptDigest?: string | null;
  challengeId?: string | null;
  authorityRevision?: number | null;
  source?: 'server' | 'client' | 'outbox';
  sessionId?: string | null;
  clientRelease?: string | null;
  durationMs?: number | null;
  failurePhase?: DailyFritzFailurePhase | null;
  recoveryClass?: DailyFritzRecoveryClass | null;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
};

export type DailyFritzEventRecord = DailyFritzEventInput & {
  id: string;
  createdAt: string;
};

export type DailyFritzPersistedMetricRow = {
  eventType: DailyFritzEventType;
  verifierCode: string | null;
  total: number;
};

/**
 * Best-effort append-only operational record. The unique idempotency key makes
 * retries safe even when a client loses the response after the DB write.
 */
export async function recordDailyFritzEvent(event: DailyFritzEventInput): Promise<void> {
  const failure = classifyDailyFritzFailure(event.verifierCode);
  await supabaseFetch('/rest/v1/daily_fritz_events?on_conflict=idempotency_key', {
    method: 'POST',
    headers: {
      Prefer: 'return=minimal,resolution=ignore-duplicates',
    },
    timeoutMs: DAILY_FRITZ_EVENT_WRITE_TIMEOUT_MS,
    body: JSON.stringify([{
      attempt_id: event.attemptId ?? null,
      run_date: event.runDate ?? null,
      user_id: event.userId ?? null,
      request_id: event.requestId ?? null,
      event_type: event.eventType,
      game_number: event.gameNumber ?? null,
      hand_index: event.handIndex ?? null,
      status_code: event.statusCode ?? null,
      verifier_code: event.verifierCode ?? null,
      transcript_digest: event.transcriptDigest ?? null,
      ...(isDailyFritzTransactionalAuthorityEnabled() ? {
        challenge_id: event.challengeId ?? null,
        authority_revision: event.authorityRevision ?? null,
        event_version: DAILY_FRITZ_TELEMETRY_VERSION,
        source: event.source ?? 'server',
        session_id: event.sessionId ?? null,
        client_release: event.clientRelease ?? null,
        duration_ms: event.durationMs ?? null,
        failure_phase: event.failurePhase ?? failure.phase,
        recovery_class: event.recoveryClass ?? failure.recoveryClass,
      } : {}),
      idempotency_key: event.idempotencyKey,
      payload: event.payload ?? {},
    }]),
  });
}

export async function listDailyFritzEvents(
  attemptId: string,
  limit = 200,
): Promise<DailyFritzEventRecord[]> {
  const bounded = Math.max(1, Math.min(500, Math.floor(limit)));
  const rows = await supabaseFetch<Array<Record<string, unknown>>>(
    `/rest/v1/daily_fritz_events?select=id,attempt_id,run_date,user_id,request_id,event_type,game_number,hand_index,status_code,verifier_code,transcript_digest,idempotency_key,payload,created_at&attempt_id=eq.${encodeURIComponent(attemptId)}&order=created_at.asc&limit=${bounded}`,
    { method: 'GET' },
  );
  return rows.map((row) => ({
    id: String(row.id),
    attemptId: typeof row.attempt_id === 'string' ? row.attempt_id : null,
    runDate: typeof row.run_date === 'string' ? row.run_date : null,
    userId: typeof row.user_id === 'string' ? row.user_id : null,
    requestId: typeof row.request_id === 'string' ? row.request_id : null,
    eventType: String(row.event_type) as DailyFritzEventType,
    gameNumber: typeof row.game_number === 'number' ? row.game_number : null,
    handIndex: typeof row.hand_index === 'number' ? row.hand_index : null,
    statusCode: typeof row.status_code === 'number' ? row.status_code : null,
    verifierCode: typeof row.verifier_code === 'string' ? row.verifier_code : null,
    transcriptDigest: typeof row.transcript_digest === 'string' ? row.transcript_digest : null,
    idempotencyKey: String(row.idempotency_key),
    payload: row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : {},
    createdAt: String(row.created_at),
  }));
}

/**
 * DF-G2 — per-user `verification_failed` aggregation for the ops alert. Counts a
 * user's `verification_failed` events in a recent window so a serial
 * transcript-tamperer shows up as a pattern rather than a string of one-offs.
 * Best-effort: returns 0 on any failure (the alert still fires without the
 * count).
 */
export async function countRecentDailyFritzVerificationFailures(
  userId: string,
  options: { days?: number; cap?: number } = {},
): Promise<number> {
  const days = Math.max(1, Math.min(90, Math.floor(options.days ?? 7)));
  const cap = Math.max(1, Math.min(200, Math.floor(options.cap ?? 50)));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  try {
    const rows = await supabaseFetch<Array<{ id: string }>>(
      `/rest/v1/daily_fritz_events?select=id&event_type=eq.verification_failed&user_id=eq.${encodeURIComponent(userId)}&created_at=gte.${encodeURIComponent(since)}&limit=${cap}`,
      { method: 'GET', timeoutMs: 2_500, circuitBreakable: true },
    );
    return Array.isArray(rows) ? rows.length : 0;
  } catch {
    return 0;
  }
}

export async function listDailyFritzPersistedMetrics(): Promise<DailyFritzPersistedMetricRow[]> {
  const rows = await supabaseFetch<Array<Record<string, unknown>>>(
    '/rest/v1/daily_fritz_event_metrics?select=event_type,verifier_code,total',
    { method: 'GET' },
  );
  return rows.map((row) => ({
    eventType: String(row.event_type) as DailyFritzEventType,
    verifierCode: typeof row.verifier_code === 'string' ? row.verifier_code : null,
    total: Number(row.total) || 0,
  }));
}

export function getDailyFritzEventsPersistenceAvailability(): boolean | null {
  return dailyFritzEventsPersistenceAvailable;
}

export async function probeDailyFritzEventsPersistence(): Promise<boolean> {
  try {
    await supabaseFetch('/rest/v1/daily_fritz_event_metrics?select=event_type&limit=1', {
      method: 'GET',
      timeoutMs: 3_000,
    });
    dailyFritzEventsPersistenceAvailable = true;
  } catch {
    dailyFritzEventsPersistenceAvailable = false;
  }
  return dailyFritzEventsPersistenceAvailable;
}
