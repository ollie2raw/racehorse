import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearGameActionIdempotencyForRoom,
  digestGameActionRequest,
  GAME_ACTION_IDEMPOTENCY_TTL_MS,
  getGameActionIdempotencyCacheSize,
  resetGameActionIdempotencyForTests,
  withGameActionIdempotency,
} from './gameActionIdempotency';

describe('gameActionIdempotency', () => {
  beforeEach(() => {
    resetGameActionIdempotencyForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('executes once and replays cached ack for duplicate requestId', async () => {
    let mutations = 0;
    const execute = vi.fn(async () => {
      mutations += 1;
      return { ok: true, sequence: 12 };
    });

    const first = await withGameActionIdempotency('room1', 'seat-a', 'req-1', execute);
    const second = await withGameActionIdempotency('room1', 'seat-a', 'req-1', execute);

    expect(first).toEqual({ ok: true, sequence: 12 });
    expect(second).toEqual({ ok: true, sequence: 12, duplicate: true });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(mutations).toBe(1);
  });

  it('treats same requestId from different players independently', async () => {
    const executeA = vi.fn(async () => ({ ok: true, sequence: 3 }));
    const executeB = vi.fn(async () => ({ ok: true, sequence: 4 }));

    const ackA = await withGameActionIdempotency('room1', 'seat-a', 'shared-req', executeA);
    const ackB = await withGameActionIdempotency('room1', 'seat-b', 'shared-req', executeB);

    expect(ackA.sequence).toBe(3);
    expect(ackB.sequence).toBe(4);
    expect(executeA).toHaveBeenCalledTimes(1);
    expect(executeB).toHaveBeenCalledTimes(1);
  });

  it('rejects reuse of a requestId for a different semantic action', async () => {
    const execute = vi.fn(async () => ({ ok: true, sequence: 3 }));
    const first = await withGameActionIdempotency(
      'room1', 'seat-a', 'req-conflict', digestGameActionRequest({ type: 'PASS', sequence: 2 }), execute,
    );
    const conflict = await withGameActionIdempotency(
      'room1', 'seat-a', 'req-conflict', digestGameActionRequest({ type: 'DRAW', sequence: 2 }), execute,
    );
    expect(first.ok).toBe(true);
    expect(conflict).toEqual({ ok: false, error: 'request_id_conflict' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('allows different requestIds to mutate normally', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, sequence: 1 })
      .mockResolvedValueOnce({ ok: true, sequence: 2 });

    await withGameActionIdempotency('room1', 'seat-a', 'req-a', execute);
    await withGameActionIdempotency('room1', 'seat-a', 'req-b', execute);

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('does not cache failed actions so retries can execute again', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "It's not your turn." })
      .mockResolvedValueOnce({ ok: true, sequence: 9 });

    const first = await withGameActionIdempotency('room1', 'seat-a', 'retry-req', execute);
    const second = await withGameActionIdempotency('room1', 'seat-a', 'retry-req', execute);

    expect(first.ok).toBe(false);
    expect(second).toEqual({ ok: true, sequence: 9 });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('caches uncertain actions and replays the same logical request without re-executing', async () => {
    const execute = vi.fn(async () => ({
      ok: false,
      error: 'room_persistence_failed',
      uncertain: true,
      sequence: 11,
    }));

    const first = await withGameActionIdempotency('room1', 'seat-a', 'uncertain-req', execute);
    const second = await withGameActionIdempotency('room1', 'seat-a', 'uncertain-req', execute);

    expect(first).toEqual({
      ok: false,
      error: 'room_persistence_failed',
      uncertain: true,
      sequence: 11,
    });
    expect(second).toEqual({
      ok: false,
      error: 'room_persistence_failed',
      uncertain: true,
      sequence: 11,
      duplicate: true,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('clears cache entries after TTL and on room cleanup', async () => {
    await withGameActionIdempotency('room1', 'seat-a', 'ttl-req', async () => ({
      ok: true,
      sequence: 7,
    }));
    expect(getGameActionIdempotencyCacheSize('room1')).toBe(1);

    vi.advanceTimersByTime(GAME_ACTION_IDEMPOTENCY_TTL_MS + 1);

    let mutations = 0;
    await withGameActionIdempotency('room1', 'seat-a', 'ttl-req', async () => {
      mutations += 1;
      return { ok: true, sequence: 8 };
    });
    expect(mutations).toBe(1);
    expect(getGameActionIdempotencyCacheSize('room1')).toBe(1);

    clearGameActionIdempotencyForRoom('room1');
    expect(getGameActionIdempotencyCacheSize('room1')).toBe(0);
  });
});
