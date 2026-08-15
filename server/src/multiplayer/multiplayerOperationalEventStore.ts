import { createHash } from 'node:crypto';
import { config } from '../config';
import { recordOperationalFailure } from '../operationalTelemetry';
import { supabaseFetch } from '../supabaseUtils';

export type MultiplayerOperationalEventType =
  | 'action_accepted'
  | 'action_rejected'
  | 'stale_command'
  | 'request_id_conflict'
  | 'duplicate_replay'
  | 'persistence_succeeded'
  | 'persistence_failed'
  | 'room_hydration_succeeded'
  | 'room_hydration_failed'
  | 'reconnect_started'
  | 'reconnect_succeeded'
  | 'reconnect_failed';

function privacySafeRoomCode(roomCode: string): string {
  return createHash('sha256').update(roomCode.trim().toUpperCase()).digest('hex').slice(0, 16);
}

export async function recordMultiplayerOperationalEvent(input: {
  eventType: MultiplayerOperationalEventType;
  roomCode?: string | null;
  requestId?: string | null;
  actionType?: string | null;
  errorCode?: string | null;
  durationMs?: number | null;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await supabaseFetch('/rest/v1/multiplayer_operational_events?on_conflict=idempotency_key', {
    method: 'POST',
    headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' },
    timeoutMs: 2_500,
    body: JSON.stringify([{
      event_type: input.eventType,
      room_code: input.roomCode ? privacySafeRoomCode(input.roomCode) : null,
      request_id: input.requestId ?? null,
      action_type: input.actionType ?? null,
      error_code: input.errorCode ?? null,
      duration_ms: input.durationMs == null ? null : Math.max(0, Math.round(input.durationMs)),
      release: config.renderGitCommit ?? config.packageVersion,
      idempotency_key: input.idempotencyKey,
      payload: input.payload ?? {},
    }]),
  });
}

export function recordMultiplayerOperationalEventBestEffort(
  input: Parameters<typeof recordMultiplayerOperationalEvent>[0],
): void {
  void recordMultiplayerOperationalEvent(input).catch((error) => {
    recordOperationalFailure('multiplayer.operational_event_write', error, {
      eventType: input.eventType,
      idempotencyKey: input.idempotencyKey,
    });
  });
}
