import { beforeEach, describe, expect, it } from 'vitest';
import {
  getDailyFritzMetrics,
  getDailyFritzMetricRates,
  incrementDailyFritzMetric,
  resetDailyFritzMetricsForTests,
} from './dailyFritzMetrics';

describe('Daily Fritz metrics', () => {
  beforeEach(() => resetDailyFritzMetricsForTests());

  it('counts totals and verifier/error codes independently', () => {
    incrementDailyFritzMetric('verification_failed', 'wrong_actor');
    incrementDailyFritzMetric('verification_failed', 'wrong_actor');
    incrementDailyFritzMetric('verification_failed', 'illegal_action');
    incrementDailyFritzMetric('attempt_completed');

    expect(getDailyFritzMetrics()).toEqual({
      verification_failed: {
        total: 3,
        byCode: { wrong_actor: 2, illegal_action: 1 },
      },
      attempt_completed: { total: 1, byCode: {} },
    });
  });

  it('derives completion, retry, and verification-failure rates from counters', () => {
    incrementDailyFritzMetric('mutation_request');
    incrementDailyFritzMetric('mutation_request');
    incrementDailyFritzMetric('attempt_started');
    incrementDailyFritzMetric('attempt_completed');
    incrementDailyFritzMetric('retry_request');
    incrementDailyFritzMetric('hand_verified');
    incrementDailyFritzMetric('verification_failed', 'wrong_actor');

    expect(getDailyFritzMetricRates()).toEqual({
      completionRate: 1,
      retryRate: 0.5,
      verificationFailureRate: 0.5,
    });
  });
});
