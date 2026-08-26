export type DailyFritzHealthStatus = 'healthy' | 'degraded' | 'critical';

/** Tunable health thresholds — adjust after observing production baselines. */
export const DAILY_FRITZ_HEALTH_THRESHOLDS = {
  /** request_failed count above this → critical. */
  REQUEST_FAILED_CRITICAL: 5,
  /** verification_failure_rate above yesterday × this multiplier → critical. */
  VERIFICATION_FAILURE_RATE_MULTIPLIER_CRITICAL: 2,
  /** completion_rate below yesterday × this ratio → critical (with min sample). */
  COMPLETION_RATE_YESTERDAY_RATIO_CRITICAL: 0.5,
  /** Minimum attempts_started before completion-rate drop can trigger critical. */
  MIN_SAMPLE_ATTEMPTS_STARTED: 10,
  /** request_failed delta above this → degraded. */
  REQUEST_FAILED_DEGRADED_DELTA: 2,
  /** verification_failure_rate absolute above this → degraded. */
  VERIFICATION_FAILURE_RATE_DEGRADED: 0.05,
  /** completion_rate drop vs yesterday above this percentage points → degraded. */
  COMPLETION_RATE_DROP_DEGRADED_PP: 15,
  /** unranked_completion_rate above this → degraded. */
  UNRANKED_COMPLETION_RATE_DEGRADED: 0.1,
};

export type DailyFritzDayHealthMetrics = {
  runDate: string;
  attemptsStarted: number;
  attemptsCompleted: number;
  completionRate: number;
  verificationFailed: number;
  handVerified: number;
  verificationFailureRate: number;
  requestFailed: number;
  legacyUnverifiedCompletions: number;
  unrankedCompletionRate: number;
  /** Protocol-v2 attempts that entered unverified_hands on this run date. */
  unverifiedHandAttempts: number;
  /** unverifiedHandAttempts as a share of attemptsStarted. */
  unverifiedHandAttemptRate: number;
  recoveryStarted: number;
  recoveryFailed: number;
  firstMoveCount: number;
};

export type DailyFritzHealthDeltas = {
  completionRatePctPoints: number;
  verificationFailureRatePctPoints: number;
  requestFailedDelta: number;
  attemptsStartedDelta: number;
};

export function evaluateDailyFritzHealthStatus(
  today: DailyFritzDayHealthMetrics,
  yesterday: DailyFritzDayHealthMetrics,
  deltas: DailyFritzHealthDeltas,
): DailyFritzHealthStatus {
  const t = DAILY_FRITZ_HEALTH_THRESHOLDS;

  if (today.requestFailed > t.REQUEST_FAILED_CRITICAL) return 'critical';
  if (
    yesterday.verificationFailureRate > 0
    && today.verificationFailureRate > yesterday.verificationFailureRate * t.VERIFICATION_FAILURE_RATE_MULTIPLIER_CRITICAL
  ) {
    return 'critical';
  }
  if (
    today.attemptsStarted >= t.MIN_SAMPLE_ATTEMPTS_STARTED
    && yesterday.completionRate > 0
    && today.completionRate < yesterday.completionRate * t.COMPLETION_RATE_YESTERDAY_RATIO_CRITICAL
  ) {
    return 'critical';
  }

  if (deltas.requestFailedDelta > t.REQUEST_FAILED_DEGRADED_DELTA) return 'degraded';
  if (today.verificationFailureRate > t.VERIFICATION_FAILURE_RATE_DEGRADED) return 'degraded';
  if (deltas.completionRatePctPoints < -t.COMPLETION_RATE_DROP_DEGRADED_PP) return 'degraded';
  if (today.unrankedCompletionRate > t.UNRANKED_COMPLETION_RATE_DEGRADED) return 'degraded';
  if (today.recoveryFailed > today.recoveryStarted && today.recoveryStarted > 0) return 'degraded';

  return 'healthy';
}
