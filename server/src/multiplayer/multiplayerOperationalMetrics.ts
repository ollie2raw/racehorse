import { supabaseFetch } from '../supabaseUtils';
import type { MultiplayerOperationalEventType } from './multiplayerOperationalEventStore';

export type MultiplayerOperationalMetricRow = {
  event_type: MultiplayerOperationalEventType;
  error_code?: string | null;
  duration_ms?: number | null;
  created_at?: string;
};

export type MultiplayerOperationalMetrics = {
  samples: number;
  actionOutcomes: number;
  reconnectAttempts: number;
  hydrationAttempts: number;
  persistenceAttempts: number;
  reconnectSuccessRate: number | null;
  staleCommandRate: number | null;
  actionRejectionRate: number | null;
  hydrationFailureRate: number | null;
  persistenceFailureRate: number | null;
  persistenceLatencyMs: {
    p50: number | null;
    p95: number | null;
    p99: number | null;
  };
  counts: Partial<Record<MultiplayerOperationalEventType, number>>;
};

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower] ?? null;
  const lowerValue = sorted[lower] ?? 0;
  const upperValue = sorted[upper] ?? lowerValue;
  return lowerValue + (upperValue - lowerValue) * (position - lower);
}

export function aggregateMultiplayerOperationalMetrics(
  rows: readonly MultiplayerOperationalMetricRow[],
): MultiplayerOperationalMetrics {
  const counts: Partial<Record<MultiplayerOperationalEventType, number>> = {};
  for (const row of rows) counts[row.event_type] = (counts[row.event_type] ?? 0) + 1;
  const count = (eventType: MultiplayerOperationalEventType) => counts[eventType] ?? 0;

  const actionOutcomes = count('action_accepted')
    + count('action_rejected')
    + count('stale_command')
    + count('request_id_conflict');
  const rejectedActions = count('action_rejected')
    + count('stale_command')
    + count('request_id_conflict');
  const reconnectAttempts = count('reconnect_succeeded') + count('reconnect_failed');
  const hydrationAttempts = count('room_hydration_succeeded') + count('room_hydration_failed');
  const persistenceAttempts = count('persistence_succeeded') + count('persistence_failed');
  const persistenceDurations = rows
    .filter((row) => row.event_type === 'persistence_succeeded')
    .map((row) => row.duration_ms)
    .filter((duration): duration is number => typeof duration === 'number' && Number.isFinite(duration) && duration >= 0);

  return {
    samples: rows.length,
    actionOutcomes,
    reconnectAttempts,
    hydrationAttempts,
    persistenceAttempts,
    reconnectSuccessRate: ratio(count('reconnect_succeeded'), reconnectAttempts),
    staleCommandRate: ratio(count('stale_command'), actionOutcomes),
    actionRejectionRate: ratio(rejectedActions, actionOutcomes),
    hydrationFailureRate: ratio(count('room_hydration_failed'), hydrationAttempts),
    persistenceFailureRate: ratio(count('persistence_failed'), persistenceAttempts),
    persistenceLatencyMs: {
      p50: percentile(persistenceDurations, 0.5),
      p95: percentile(persistenceDurations, 0.95),
      p99: percentile(persistenceDurations, 0.99),
    },
    counts,
  };
}

export async function loadMultiplayerOperationalMetrics(input: {
  since: string;
  limit?: number;
}): Promise<MultiplayerOperationalMetrics & { truncated: boolean }> {
  const limit = Math.min(50_000, Math.max(1, Math.round(input.limit ?? 10_000)));
  const rows = await supabaseFetch<MultiplayerOperationalMetricRow[]>(
    `/rest/v1/multiplayer_operational_events?select=event_type,error_code,duration_ms,created_at&created_at=gte.${encodeURIComponent(input.since)}&order=created_at.asc&limit=${limit}`,
    { timeoutMs: 10_000 },
  );
  const normalizedRows = Array.isArray(rows) ? rows : [];
  return {
    ...aggregateMultiplayerOperationalMetrics(normalizedRows),
    truncated: normalizedRows.length >= limit,
  };
}
