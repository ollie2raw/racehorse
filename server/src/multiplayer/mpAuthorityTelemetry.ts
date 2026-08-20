/**
 * Structured private-match authority telemetry (server).
 * Emits operational logs with a stable failure/funnel taxonomy for dashboards.
 */

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
  | 'private_move_log_verification_failed';

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

type EmitPayload = {
  roomCode?: string;
  seatId?: string;
  requestId?: string;
  sequence?: number | null;
  failureCode?: MpAuthorityFailureCode;
  extra?: Record<string, unknown>;
};

export function emitMpAuthorityFunnel(
  event: MpAuthorityFunnelEvent,
  payload: EmitPayload = {},
): void {
  const line = {
    channel: 'mp.authority',
    event,
    ts: new Date().toISOString(),
    roomCode: payload.roomCode ?? null,
    seatId: payload.seatId ?? null,
    requestId: payload.requestId ?? null,
    sequence: payload.sequence ?? null,
    failureCode: payload.failureCode ?? null,
    ...(payload.extra ?? {}),
  };
  // Structured single-line JSON for log shippers / Sentry breadcrumbs.
  console.info('[mp.authority]', JSON.stringify(line));
}
