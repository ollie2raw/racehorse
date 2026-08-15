import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../supabaseUtils', () => ({ supabaseFetch: vi.fn() }));

import { supabaseFetch } from '../../supabaseUtils';
import { recordDailyPuzzleEvent } from './dailyPuzzleEventStore';

describe('Daily Puzzle event store', () => {
  beforeEach(() => vi.mocked(supabaseFetch).mockReset());

  it('writes idempotent canonical events to durable storage', async () => {
    vi.mocked(supabaseFetch).mockResolvedValue(undefined);
    await recordDailyPuzzleEvent({
      attemptId: '11111111-1111-4111-8111-111111111111',
      runDate: '2026-08-06',
      userId: '22222222-2222-4222-8222-222222222222',
      eventType: 'slot_submitted',
      slotIndex: 5,
      idempotencyKey: 'attempt-1:slot-5',
    });

    expect(supabaseFetch).toHaveBeenCalledWith(
      '/rest/v1/daily_puzzle_events?on_conflict=idempotency_key',
      expect.objectContaining({
        method: 'POST',
        headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' },
      }),
    );
    const body = JSON.parse(String(vi.mocked(supabaseFetch).mock.calls[0]?.[1]?.body))[0];
    expect(body).toMatchObject({
      event_type: 'slot_submitted',
      event_version: 2,
      slot_index: 5,
      source: 'server',
      idempotency_key: 'attempt-1:slot-5',
    });
  });

  it.each([
    ['verification_failed', 'illegal_line', 'verification', 'terminal_integrity_failure'],
    ['command_conflict', 'slot_order_invalid', 'command', 'authoritative_refresh'],
    ['request_failed', 'incompatible_version', 'challenge', 'client_update_required'],
  ] as const)('emits %s with canonical failure classification', async (
    eventType,
    failureCode,
    failurePhase,
    recoveryClass,
  ) => {
    vi.mocked(supabaseFetch).mockResolvedValue(undefined);
    await recordDailyPuzzleEvent({
      runDate: '2026-08-08',
      userId: '22222222-2222-4222-8222-222222222222',
      eventType,
      failureCode,
      idempotencyKey: `failure:${eventType}`,
    });

    const body = JSON.parse(String(vi.mocked(supabaseFetch).mock.calls[0]?.[1]?.body))[0];
    expect(body).toMatchObject({
      event_type: eventType,
      failure_code: failureCode,
      failure_phase: failurePhase,
      recovery_class: recoveryClass,
      event_version: 2,
    });
  });

  it('preserves one idempotency identity when a response is lost and retried', async () => {
    vi.mocked(supabaseFetch).mockRejectedValueOnce(new Error('response_lost')).mockResolvedValueOnce(undefined);
    const event = {
      runDate: '2026-08-06',
      userId: '22222222-2222-4222-8222-222222222222',
      eventType: 'first_move' as const,
      idempotencyKey: 'first-move-1',
    };
    await expect(recordDailyPuzzleEvent(event)).rejects.toThrow('response_lost');
    await expect(recordDailyPuzzleEvent(event)).resolves.toBeUndefined();
    expect(vi.mocked(supabaseFetch).mock.calls[0]?.[1]?.body)
      .toBe(vi.mocked(supabaseFetch).mock.calls[1]?.[1]?.body);
  });
});
