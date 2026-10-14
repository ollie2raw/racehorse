import { normalizeDailyFritzSetResult } from './http/stores/dailyFritzStore';
import { DAILY_FRITZ_RECOVERY_RESULT_FIELDS } from './dailyFritzRecoveryProjection';
export { projectDailyFritzRecoveryResult, type DailyFritzRecoveryCandidate } from './dailyFritzRecoveryProjection';

export function classifyDailyFritzRecovery(result: Record<string, unknown> | null): 'incomplete' | 'complete' | 'ambiguous' {
  if (!result || DAILY_FRITZ_RECOVERY_RESULT_FIELDS.every((key) => result[key] == null)) return 'incomplete';
  const normalized = normalizeDailyFritzSetResult(result);
  if (!normalized) return 'ambiguous';
  return normalized.setWinner ? 'complete' : 'incomplete';
}
