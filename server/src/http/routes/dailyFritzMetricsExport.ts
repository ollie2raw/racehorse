import type { DailyFritzMetricName } from './dailyFritzMetrics';

const METRIC_EVENT_MAP: Partial<Record<DailyFritzMetricName, 'request_failed' | 'verification_failed'>> = {
  request_failed: 'request_failed',
  verification_failed: 'verification_failed',
};

/** Best-effort: mirror high-signal in-memory counters into durable events. */
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
