export const DAILY_FRITZ_TELEMETRY_VERSION = 1 as const;

export const DAILY_FRITZ_EVENT_TYPES = [
  'mode_impression',
  'start_requested',
  'attempt_started',
  'attempt_resumed',
  'first_move',
  'hand_started',
  'hand_verified',
  'next_hand_replayed',
  'game_started',
  'game_recorded',
  'async_verification_scheduled',
  'set_continued',
  'attempt_completed',
  'attempt_abandoned',
  'verification_failed',
  'command_conflict',
  'recovery_started',
  'recovery_succeeded',
  'recovery_failed',
  'request_failed',
  'retry_request',
  'review_opened',
  'leaderboard_opened',
  'share_requested',
  'share_completed',
  'checkpoint_saved',
] as const;

export type DailyFritzEventType = typeof DAILY_FRITZ_EVENT_TYPES[number];

export type DailyFritzFailurePhase =
  | 'challenge'
  | 'start'
  | 'verification'
  | 'command'
  | 'persistence'
  | 'recovery'
  | 'submission'
  | 'unknown';

export type DailyFritzRecoveryClass =
  | 'transparent_retry'
  | 'authoritative_refresh'
  | 'client_update_required'
  | 'terminal_integrity_failure'
  | 'not_applicable';

const UPDATE_REQUIRED = new Set([
  'authority_contract_unsupported',
  'incompatible_version',
  'unsupported_protocol',
  'unsupported_policy',
]);
const AUTHORITATIVE_REFRESH = new Set([
  'stale_revision',
  'command_slot_conflict',
  'fritz_state_mismatch',
  'wrong_actor',
  'state_digest_mismatch',
  'attempt_not_active',
]);
const TERMINAL_INTEGRITY = new Set([
  'challenge_mismatch',
  'challenge_publication_mismatch',
  'operation_id_reused',
  'transcript_digest_mismatch',
  'illegal_action',
  'post_play_recovery_draw',
]);

export function isDailyFritzEventType(value: unknown): value is DailyFritzEventType {
  return typeof value === 'string'
    && (DAILY_FRITZ_EVENT_TYPES as readonly string[]).includes(value);
}

export function classifyDailyFritzFailure(code: string | null | undefined): {
  phase: DailyFritzFailurePhase;
  recoveryClass: DailyFritzRecoveryClass;
} {
  const normalized = code?.trim().toLowerCase() || '';
  if (!normalized) return { phase: 'unknown', recoveryClass: 'not_applicable' };
  if (UPDATE_REQUIRED.has(normalized)) {
    return { phase: 'challenge', recoveryClass: 'client_update_required' };
  }
  if (AUTHORITATIVE_REFRESH.has(normalized)) {
    return { phase: normalized === 'stale_revision' ? 'command' : 'verification', recoveryClass: 'authoritative_refresh' };
  }
  if (TERMINAL_INTEGRITY.has(normalized)) {
    return {
      phase: normalized.startsWith('challenge_') ? 'challenge' : 'verification',
      recoveryClass: 'terminal_integrity_failure',
    };
  }
  if (/timeout|network|unavailable|rate_limit|persistence/.test(normalized)) {
    return { phase: 'persistence', recoveryClass: 'transparent_retry' };
  }
  return { phase: 'unknown', recoveryClass: 'authoritative_refresh' };
}
