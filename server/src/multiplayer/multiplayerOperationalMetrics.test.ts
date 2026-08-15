import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabaseUtils', () => ({ supabaseFetch: vi.fn() }));

import { supabaseFetch } from '../supabaseUtils';
import {
  aggregateMultiplayerOperationalMetrics,
  loadMultiplayerOperationalMetrics,
  type MultiplayerOperationalMetricRow,
} from './multiplayerOperationalMetrics';

describe('multiplayer fleet-wide operational metrics', () => {
  beforeEach(() => vi.mocked(supabaseFetch).mockReset());

  it('computes canonical rates and continuous latency percentiles', () => {
    const rows: MultiplayerOperationalMetricRow[] = [
      { event_type: 'action_accepted' },
      { event_type: 'action_accepted' },
      { event_type: 'action_rejected' },
      { event_type: 'stale_command' },
      { event_type: 'reconnect_succeeded' },
      { event_type: 'reconnect_failed' },
      { event_type: 'room_hydration_succeeded' },
      { event_type: 'room_hydration_succeeded' },
      { event_type: 'room_hydration_failed' },
      { event_type: 'persistence_succeeded', duration_ms: 10 },
      { event_type: 'persistence_succeeded', duration_ms: 20 },
      { event_type: 'persistence_succeeded', duration_ms: 30 },
      { event_type: 'persistence_failed' },
    ];

    const metrics = aggregateMultiplayerOperationalMetrics(rows);
    expect(metrics.actionOutcomes).toBe(4);
    expect(metrics.actionRejectionRate).toBe(0.5);
    expect(metrics.staleCommandRate).toBe(0.25);
    expect(metrics.reconnectSuccessRate).toBe(0.5);
    expect(metrics.hydrationFailureRate).toBeCloseTo(1 / 3);
    expect(metrics.persistenceFailureRate).toBe(0.25);
    expect(metrics.persistenceLatencyMs).toEqual({ p50: 20, p95: 29, p99: 29.8 });
  });

  it('returns null rates when no denominator exists', () => {
    const metrics = aggregateMultiplayerOperationalMetrics([]);
    expect(metrics.reconnectSuccessRate).toBeNull();
    expect(metrics.actionRejectionRate).toBeNull();
    expect(metrics.persistenceLatencyMs.p95).toBeNull();
  });

  it('loads bounded fleet events and marks a saturated window as truncated', async () => {
    vi.mocked(supabaseFetch).mockResolvedValue([
      { event_type: 'reconnect_succeeded' },
      { event_type: 'reconnect_failed' },
    ]);

    const metrics = await loadMultiplayerOperationalMetrics({
      since: '2026-08-08T00:00:00.000Z',
      limit: 2,
    });

    expect(supabaseFetch).toHaveBeenCalledWith(
      expect.stringContaining('created_at=gte.2026-08-08T00%3A00%3A00.000Z'),
      { timeoutMs: 10_000 },
    );
    expect(metrics.reconnectSuccessRate).toBe(0.5);
    expect(metrics.truncated).toBe(true);
  });
});
