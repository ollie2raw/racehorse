import type { DailyFritzMetricName } from './dailyFritzMetrics';

const METRIC_EVENT_MAP: Partial<Record<DailyFritzMetricName, import('../../dailyFritzTelemetry').DailyFritzEventType>> = {
  attempt_started: 'attempt_started',
  attempt_completed: 'attempt_completed',
  attempt_abandoned: 'attempt_abandoned',
  hand_verified: 'hand_verified',
  game_recorded: 'game_recorded',
  next_hand_replayed: 'next_hand_replayed',
  request_failed: 'request_failed',
  verification_failed: 'verification_failed',
  retry_request: 'retry_request',
  command_conflict: 'command_conflict',
  checkpoint_saved: 'checkpoint_saved',
};

/**
 * Best-effort durable mirror.
 *
 * Canonical Phase 4 alerting/dashboard metrics should read from persisted
 * daily_fritz_events aggregates, while in-memory counters remain a local cache.
 */
export function mirrorDailyFritzMetricIncrementBestEffort(
  name: DailyFritzMetricName,
  code?: string | null,
): void {
  const eventType = METRIC_EVENT_MAP[name];
  if (!eventType) return;
  void import('./dailyFritzVerificationGlue').then(({ recordDailyFritzEventBestEffort }) =>
    recordDailyFritzEventBestEffort({
      attemptId: null,
      runDate: null,
      userId: null,
      eventType,
      idempotencyKey: `metric:${name}:${code ?? 'none'}:${Date.now()}`,
      verifierCode: code ?? null,
      payload: { metric: name },
    }),
  ).catch(() => {});
}
