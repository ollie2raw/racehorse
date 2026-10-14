import { normalizeDailyFritzSetResult } from './http/stores/dailyFritzStore';
import { DAILY_FRITZ_RECOVERY_RESULT_FIELDS } from './dailyFritzRecoveryProjection';
export { projectDailyFritzRecoveryResult, type DailyFritzRecoveryCandidate } from './dailyFritzRecoveryProjection';

export function classifyDailyFritzRecovery(result: unknown): 'incomplete' | 'complete' | 'ambiguous' {
  try {
    if (result == null) return 'incomplete';
    if (typeof result !== 'object' || Array.isArray(result)) return 'ambiguous';
    const record = result as Record<string, unknown>;
    if (DAILY_FRITZ_RECOVERY_RESULT_FIELDS.every((key) => record[key] == null)) return 'incomplete';
    // The normalizer coerces game numbers/scores/counters with Number(). JSON
    // objects can override valueOf/toString with non-callable values and throw.
    // Keep all property access and normalization inside this boundary, without
    // changing the established interpretation of valid results.
    const normalized = normalizeDailyFritzSetResult(record);
    if (!normalized) return 'ambiguous';
    return normalized.setWinner ? 'complete' : 'incomplete';
  } catch {
    return 'ambiguous';
  }
}
