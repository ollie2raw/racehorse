import { describe, expect, it } from 'vitest';
import {
  DAILY_FRITZ_HEALTH_THRESHOLDS,
  evaluateDailyFritzHealthStatus,
  type DailyFritzDayHealthMetrics,
} from './dailyFritzHealthPolicy';

function day(overrides: Partial<DailyFritzDayHealthMetrics> = {}): DailyFritzDayHealthMetrics {
  return {
    runDate: '2026-08-19',
    attemptsStarted: 100,
    attemptsCompleted: 70,
    completionRate: 0.7,
    verificationFailed: 2,
    handVerified: 98,
    verificationFailureRate: 0.02,
    requestFailed: 0,
    legacyUnverifiedCompletions: 3,
    unrankedCompletionRate: 0.043,
    recoveryStarted: 1,
    recoveryFailed: 0,
    firstMoveCount: 95,
    ...overrides,
  };
}

describe('evaluateDailyFritzHealthStatus', () => {
  it('returns healthy when metrics are within thresholds', () => {
    const today = day();
    const yesterday = day({ completionRate: 0.72, verificationFailureRate: 0.02 });
    const deltas = { completionRatePctPoints: -2, verificationFailureRatePctPoints: 0, requestFailedDelta: 0, attemptsStartedDelta: 0 };
    expect(evaluateDailyFritzHealthStatus(today, yesterday, deltas)).toBe('healthy');
  });

  it('returns critical when request_failed exceeds the critical threshold', () => {
    const today = day({ requestFailed: DAILY_FRITZ_HEALTH_THRESHOLDS.REQUEST_FAILED_CRITICAL + 1 });
    const yesterday = day();
    const deltas = { completionRatePctPoints: 0, verificationFailureRatePctPoints: 0, requestFailedDelta: 6, attemptsStartedDelta: 0 };
    expect(evaluateDailyFritzHealthStatus(today, yesterday, deltas)).toBe('critical');
  });

  it('returns critical when completion rate collapses vs yesterday with enough sample', () => {
    const yesterday = day({ completionRate: 0.8 });
    const today = day({
      attemptsStarted: DAILY_FRITZ_HEALTH_THRESHOLDS.MIN_SAMPLE_ATTEMPTS_STARTED,
      completionRate: 0.3,
    });
    const deltas = { completionRatePctPoints: -50, verificationFailureRatePctPoints: 0, requestFailedDelta: 0, attemptsStartedDelta: 0 };
    expect(evaluateDailyFritzHealthStatus(today, yesterday, deltas)).toBe('critical');
  });

  it('returns degraded when unranked completion rate is elevated', () => {
    const today = day({
      unrankedCompletionRate: DAILY_FRITZ_HEALTH_THRESHOLDS.UNRANKED_COMPLETION_RATE_DEGRADED + 0.05,
      legacyUnverifiedCompletions: 12,
      attemptsCompleted: 50,
    });
    const yesterday = day();
    const deltas = { completionRatePctPoints: 0, verificationFailureRatePctPoints: 0, requestFailedDelta: 0, attemptsStartedDelta: 0 };
    expect(evaluateDailyFritzHealthStatus(today, yesterday, deltas)).toBe('degraded');
  });
});
