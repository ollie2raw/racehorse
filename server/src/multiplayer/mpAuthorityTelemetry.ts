/**
 * Structured private-match authority telemetry (server).
 * Emits operational logs with a stable failure/funnel taxonomy for dashboards.
 */

import {
  queueMpAuthorityEventPersist,
  type MpAuthorityEventRecord,
} from './mpAuthorityEventStore';

export type MpAuthorityFunnelEvent =
  | 'private_lobby_created'
  | 'private_match_started'
  | 'private_action_committed'
  | 'private_action_uncertain'
  | 'private_action_duplicate'
  | 'private_reconnect_hydrated'
  | 'private_receipts_hydrated'
  | 'private_rematch_started'
  | 'private_match_abandoned'
  | 'private_match_archived'
  | 'private_durability_degraded'
  | 'private_durability_failed'
  | 'private_move_log_verification_failed'
  | 'private_terminal_recovery'
  | 'private_disconnect_auto_act_deferred'
  | 'private_disconnect_auto_act_paused';

export type MpAuthorityFailureCode =
  | 'missing_request_id'
  | 'room_persistence_failed'
  | 'room_degraded'
  | 'room_failed'
  | 'invariant_violation'
  | 'hydration_rejected'
  | 'session_superseded'
  | 'recovery_exhausted'
  | 'move_log_verification_failed';

export type MpAuthoritySourceType = 'private' | 'quick' | 'tournament';

type EmitPayload = {
  roomCode?: string;
  seatId?: string;
  requestId?: string;
  sequence?: number | null;
  failureCode?: MpAuthorityFailureCode;
  sourceType?: MpAuthoritySourceType;
  extra?: Record<string, unknown>;
};

export function resolveMpAuthoritySourceType(room: {
  matchmakingMatchId?: string | null;
  scheduledTournamentMatchId?: string | null;
  config?: { tournamentId?: string };
}): MpAuthoritySourceType {
  if (room.scheduledTournamentMatchId || room.config?.tournamentId) return 'tournament';
  if (room.matchmakingMatchId) return 'quick';
  return 'private';
}

export function emitMpAuthorityFunnel(
  event: MpAuthorityFunnelEvent,
  payload: EmitPayload = {},
): void {
  const ts = new Date().toISOString();
  const line = {
    channel: 'mp.authority',
    event,
    ts,
    roomCode: payload.roomCode ?? null,
    seatId: payload.seatId ?? null,
    requestId: payload.requestId ?? null,
    sequence: payload.sequence ?? null,
    failureCode: payload.failureCode ?? null,
    sourceType: payload.sourceType ?? null,
    ...(payload.extra ?? {}),
  };
  // Structured single-line JSON for log shippers / Sentry breadcrumbs.
  console.info('[mp.authority]', JSON.stringify(line));

  const record: MpAuthorityEventRecord = {
    event,
    ts,
    roomCode: payload.roomCode ?? null,
    seatId: payload.seatId ?? null,
    requestId: payload.requestId ?? null,
    failureCode: payload.failureCode ?? null,
    sourceType: payload.sourceType ?? null,
    payload: {
      ...(payload.extra ?? {}),
      ...(payload.sequence != null ? { sequence: payload.sequence } : {}),
    },
  };
  queueMpAuthorityEventPersist(record);
}

const HYDRATION_REJECT_KINDS = new Set([
  'snapshot_invalid',
  'snapshot_stale',
  'snapshot_freshness_unknown',
  'persistence_unavailable',
]);

export function emitMpAuthorityHydrationResult(
  roomCode: string,
  result: { kind: string; error?: string },
): void {
  if (result.kind === 'hydrated') {
    emitMpAuthorityFunnel('private_reconnect_hydrated', { roomCode });
    return;
  }
  if (!HYDRATION_REJECT_KINDS.has(result.kind)) return;
  const failed = result.kind === 'snapshot_invalid' || result.kind === 'persistence_unavailable';
  emitMpAuthorityFunnel(failed ? 'private_durability_failed' : 'private_durability_degraded', {
    roomCode,
    failureCode: result.kind === 'persistence_unavailable'
      ? 'room_persistence_failed'
      : 'hydration_rejected',
    extra: { hydrationKind: result.kind, error: result.error ?? null },
  });
}
