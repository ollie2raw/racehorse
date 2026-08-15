export const DAILY_PUZZLE_TELEMETRY_VERSION = 2 as const;

export const DAILY_PUZZLE_EVENT_TYPES = [
  'mode_impression',
  'start_requested',
  'attempt_started',
  'attempt_resumed',
  'first_move',
  'slot_submitted',
  'attempt_abandoned',
  'recovery_started',
  'recovery_succeeded',
  'recovery_failed',
  'attempt_completed',
  'share_requested',
  'share_completed',
  'verification_failed',
  'command_conflict',
  'retry_requested',
  'review_opened',
  'leaderboard_opened',
  'request_failed',
] as const;

export type DailyPuzzleEventType = typeof DAILY_PUZZLE_EVENT_TYPES[number];
export const DAILY_PUZZLE_CLIENT_EVENT_TYPES = [
  'start_requested',
  'first_move',
  'attempt_abandoned',
  'recovery_started',
  'recovery_succeeded',
  'recovery_failed',
  'share_requested',
  'share_completed',
  'retry_requested',
  'review_opened',
  'leaderboard_opened',
  'request_failed',
] as const satisfies readonly DailyPuzzleEventType[];
export type DailyPuzzleFailurePhase =
  | 'challenge'
  | 'start'
  | 'verification'
  | 'command'
  | 'persistence'
  | 'recovery'
  | 'submission'
  | 'unknown';
export type DailyPuzzleRecoveryClass =
  | 'transparent_retry'
  | 'authoritative_refresh'
  | 'client_update_required'
  | 'terminal_integrity_failure'
  | 'not_applicable';

export function isDailyPuzzleEventType(value: unknown): value is DailyPuzzleEventType {
  return typeof value === 'string'
    && (DAILY_PUZZLE_EVENT_TYPES as readonly string[]).includes(value);
}

export function isDailyPuzzleClientEventType(value: unknown): value is DailyPuzzleEventType {
  return typeof value === 'string'
    && (DAILY_PUZZLE_CLIENT_EVENT_TYPES as readonly string[]).includes(value);
}

export function classifyDailyPuzzleFailure(code: string | null | undefined): {
  phase: DailyPuzzleFailurePhase;
  recoveryClass: DailyPuzzleRecoveryClass;
} {
  const normalized = code?.trim().toLowerCase() || '';
  if (!normalized) return { phase: 'unknown', recoveryClass: 'not_applicable' };
  if (/timeout|network|unavailable|rate_limit/.test(normalized)) {
    return { phase: 'persistence', recoveryClass: 'transparent_retry' };
  }
  if (/incompatible_version|unsupported_version|version_mismatch/.test(normalized)) {
    return { phase: 'challenge', recoveryClass: 'client_update_required' };
  }
  if (/stale_revision|slot_order|attempt_completed|attempt_not_found/.test(normalized)) {
    return { phase: 'command', recoveryClass: 'authoritative_refresh' };
  }
  if (/illegal|inventory|turn|score|transcript|line|puzzle_mismatch|wrong_actor/.test(normalized)) {
    return { phase: 'verification', recoveryClass: 'terminal_integrity_failure' };
  }
  return { phase: 'unknown', recoveryClass: 'authoritative_refresh' };
}

export function failureEventTypeForDailyPuzzleCode(code: string | null | undefined):
  | 'verification_failed'
  | 'command_conflict'
  | 'request_failed' {
  const { phase } = classifyDailyPuzzleFailure(code);
  if (phase === 'verification') return 'verification_failed';
  if (phase === 'command') return 'command_conflict';
  return 'request_failed';
}

export function normalizeDailyPuzzleFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96) || 'unknown';
}
