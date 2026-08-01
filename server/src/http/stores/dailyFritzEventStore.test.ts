import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../supabaseUtils', () => ({ supabaseFetch: vi.fn() }));

import { supabaseFetch } from '../../supabaseUtils';
import {
  DAILY_FRITZ_EVENT_WRITE_TIMEOUT_MS,
  listDailyFritzEvents,
  listDailyFritzPersistedMetrics,
  recordDailyFritzEvent,
} from './dailyFritzEventStore';

describe('Daily Fritz event store', () => {
  beforeEach(() => vi.mocked(supabaseFetch).mockReset());

  it('writes a normalized idempotent event to PostgREST', async () => {
    vi.mocked(supabaseFetch).mockResolvedValue(undefined);

    await recordDailyFritzEvent({
      attemptId: 'attempt-1',
      runDate: '2026-07-31',
      userId: 'user-1',
      requestId: 'request-1',
      eventType: 'hand_verified',
      gameNumber: 2,
      handIndex: 4,
      transcriptDigest: 'digest-1',
      idempotencyKey: 'attempt-1:hand_verified:2:4:digest-1',
      payload: { actionCount: 18 },
    });

    expect(supabaseFetch).toHaveBeenCalledWith(
      '/rest/v1/daily_fritz_events?on_conflict=idempotency_key',
      expect.objectContaining({
        method: 'POST',
        headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' },
        timeoutMs: DAILY_FRITZ_EVENT_WRITE_TIMEOUT_MS,
      }),
    );
    const [, init] = vi.mocked(supabaseFetch).mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual([expect.objectContaining({
      event_type: 'hand_verified',
      idempotency_key: 'attempt-1:hand_verified:2:4:digest-1',
    })]);
  });

  it('lists a bounded chronological attempt timeline for operations', async () => {
    vi.mocked(supabaseFetch).mockResolvedValue([{
      id: 'event-1',
      attempt_id: 'attempt-1',
      event_type: 'hand_verified',
      idempotency_key: 'key-1',
      payload: { actionCount: 4 },
      created_at: '2026-07-31T20:00:00.000Z',
    }]);

    await expect(listDailyFritzEvents('attempt-1', 900)).resolves.toEqual([
      expect.objectContaining({
        id: 'event-1',
        attemptId: 'attempt-1',
        eventType: 'hand_verified',
        createdAt: '2026-07-31T20:00:00.000Z',
      }),
    ]);
    expect(supabaseFetch).toHaveBeenCalledWith(
      expect.stringContaining('limit=500'),
      { method: 'GET' },
    );
  });

  it('reads restart-safe aggregate counters from the database view', async () => {
    vi.mocked(supabaseFetch).mockResolvedValue([
      { event_type: 'verification_failed', verifier_code: 'wrong_actor', total: 3 },
      { event_type: 'hand_verified', verifier_code: null, total: 7 },
    ]);

    await expect(listDailyFritzPersistedMetrics()).resolves.toEqual([
      { eventType: 'verification_failed', verifierCode: 'wrong_actor', total: 3 },
      { eventType: 'hand_verified', verifierCode: null, total: 7 },
    ]);
    expect(supabaseFetch).toHaveBeenCalledWith(
      '/rest/v1/daily_fritz_event_metrics?select=event_type,verifier_code,total',
      { method: 'GET' },
    );
  });

  it('reuses the same idempotency key when the first write loses its response', async () => {
    vi.mocked(supabaseFetch)
      .mockRejectedValueOnce(new Error('response lost after remote write'))
      .mockResolvedValueOnce(undefined);
    const event = {
      attemptId: 'attempt-1',
      runDate: '2026-07-31',
      userId: 'user-1',
      requestId: 'request-retry',
      eventType: 'game_recorded' as const,
      gameNumber: 2,
      idempotencyKey: 'attempt-1:game_recorded:2:hand-digest',
      payload: { replayed: false },
    };

    await expect(recordDailyFritzEvent(event)).rejects.toThrow('response lost');
    await expect(recordDailyFritzEvent(event)).resolves.toBeUndefined();
    expect(supabaseFetch).toHaveBeenCalledTimes(2);
    const firstBody = vi.mocked(supabaseFetch).mock.calls[0]?.[1]?.body;
    const secondBody = vi.mocked(supabaseFetch).mock.calls[1]?.[1]?.body;
    expect(secondBody).toBe(firstBody);
  });
});
