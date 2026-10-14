import type { DailyFritzAttemptRecord } from './http/stores/dailyFritzStore';

// These are ALL inputs to the completion decision: game validation and winner
// derivation/aliases. Authority, checkpoints and score publication are only
// needed after eligibility, when the finalizer reads the full current row.
export const DAILY_FRITZ_RECOVERY_RESULT_FIELDS = ['version', 'format', 'games', 'setWinner', 'set_winner'] as const;

export type DailyFritzRecoveryCandidate = Pick<DailyFritzAttemptRecord, 'id' | 'userId' | 'runDate' | 'startedAt'> & {
  result: Record<string, unknown> | null;
};

export function projectDailyFritzRecoveryResult(result: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!result) return null;
  return Object.fromEntries(DAILY_FRITZ_RECOVERY_RESULT_FIELDS.map((key) => [key, result[key]]));
}

