import { supabaseFetch } from '../../supabaseUtils';
import {
  DAILY_PUZZLE_TELEMETRY_VERSION,
  classifyDailyPuzzleFailure,
  type DailyPuzzleEventType,
  type DailyPuzzleFailurePhase,
  type DailyPuzzleRecoveryClass,
} from '../../dailyPuzzleTelemetry';

export type DailyPuzzleEventInput = {
  attemptId?: string | null;
  runDate: string;
  userId: string;
  eventType: DailyPuzzleEventType;
  slotIndex?: number | null;
  requestId?: string | null;
  failureCode?: string | null;
  failurePhase?: DailyPuzzleFailurePhase | null;
  recoveryClass?: DailyPuzzleRecoveryClass | null;
  sessionId?: string | null;
  clientRelease?: string | null;
  durationMs?: number | null;
  source?: 'server' | 'client';
  idempotencyKey: string;
  payload?: Record<string, unknown>;
};

export async function recordDailyPuzzleEvent(event: DailyPuzzleEventInput): Promise<void> {
  const failure = classifyDailyPuzzleFailure(event.failureCode);
  await supabaseFetch('/rest/v1/daily_puzzle_events?on_conflict=idempotency_key', {
    method: 'POST',
    headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' },
    timeoutMs: 2_500,
    body: JSON.stringify([{
      attempt_id: event.attemptId ?? null,
      run_date: event.runDate,
      user_id: event.userId,
      event_type: event.eventType,
      event_version: DAILY_PUZZLE_TELEMETRY_VERSION,
      slot_index: event.slotIndex ?? null,
      request_id: event.requestId ?? null,
      failure_code: event.failureCode ?? null,
      failure_phase: event.failurePhase ?? failure.phase,
      recovery_class: event.recoveryClass ?? failure.recoveryClass,
      session_id: event.sessionId ?? null,
      client_release: event.clientRelease ?? null,
      duration_ms: event.durationMs ?? null,
      source: event.source ?? 'server',
      idempotency_key: event.idempotencyKey,
      payload: event.payload ?? {},
    }]),
  });
}
