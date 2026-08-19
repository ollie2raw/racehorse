export type DailyFritzMetricName =
  | 'attempt_started'
  | 'attempt_completed'
  | 'attempt_abandoned'
  | 'hand_verified'
  | 'game_recorded'
  | 'next_hand_replayed'
  | 'request_failed'
  | 'verification_failed'
  /** A hand advanced without a receipt so the player was not stranded. */
  | 'verification_bypassed'
  | 'retry_request'
  | 'mutation_request'
  | 'command_conflict'
  | 'event_persistence_failed'
  | 'checkpoint_saved';

type MetricBucket = {
  total: number;
  byCode: Record<string, number>;
};

// Ephemeral per-process cache only. Canonical operational metrics for
// dashboards/alerting come from durable daily_fritz_events aggregates.
const buckets = new Map<DailyFritzMetricName, MetricBucket>();

function bucket(name: DailyFritzMetricName): MetricBucket {
  const existing = buckets.get(name);
  if (existing) return existing;
  const created = { total: 0, byCode: {} };
  buckets.set(name, created);
  return created;
}

export function incrementDailyFritzMetric(
  name: DailyFritzMetricName,
  code?: string | null,
): void {
  const target = bucket(name);
  target.total += 1;
  if (code) target.byCode[code] = (target.byCode[code] ?? 0) + 1;
  // Mirror to durable events so restarts/horizontal scale keep canonical counts.
  void import('./dailyFritzMetricsExport').then(({ mirrorDailyFritzMetricIncrementBestEffort }) => {
    mirrorDailyFritzMetricIncrementBestEffort(name, code);
  }).catch(() => {});
}

export function getDailyFritzMetrics(): Record<DailyFritzMetricName, MetricBucket> {
  return Object.fromEntries(
    [...buckets.entries()].map(([name, value]) => [name, {
      total: value.total,
      byCode: { ...value.byCode },
    }]),
  ) as Record<DailyFritzMetricName, MetricBucket>;
}

export function getDailyFritzMetricRates(): {
  completionRate: number;
  retryRate: number;
  verificationFailureRate: number;
} {
  const read = (name: DailyFritzMetricName): number => buckets.get(name)?.total ?? 0;
  const started = read('attempt_started');
  const verifiedAndFailed = read('hand_verified') + read('verification_failed');
  return {
    completionRate: started === 0 ? 0 : read('attempt_completed') / started,
    retryRate: read('mutation_request') === 0 ? 0 : read('retry_request') / read('mutation_request'),
    verificationFailureRate: verifiedAndFailed === 0 ? 0 : read('verification_failed') / verifiedAndFailed,
  };
}

export function resetDailyFritzMetricsForTests(): void {
  buckets.clear();
}
