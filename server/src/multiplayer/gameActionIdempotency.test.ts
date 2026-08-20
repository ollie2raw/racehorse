import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./roomCommandReceiptStore', () => ({
  persistRoomCommandReceipt: vi.fn(async () => undefined),
  deleteRoomCommandReceiptsForRoom: vi.fn(async () => undefined),
}));

import {
  clearGameActionIdempotencyForRoom,
  GAME_ACTION_IDEMPOTENCY_TTL_MS,
  getGameActionIdempotencyCacheSize,
  hydrateGameActionReceiptsForRoom,
  resetGameActionIdempotencyForTests,
  snapshotGameActionReceiptsForRoom,
  withGameActionIdempotency,
} from './gameActionIdempotency';
import { persistRoomCommandReceipt } from './roomCommandReceiptStore';

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
    expect(persistRoomCommandReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        roomCode: 'room1',
        playerSeatId: 'seat-a',
        requestId: 'req-1',
        ack: expect.objectContaining({ ok: true, sequence: 12 }),
      }),
    );
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

  it('does not cache uncertain acks so same requestId can re-execute after rollback', async () => {
    // After mutate-then-persist rollback, uncertain means nothing stuck —
    // caching would trap actor retries (client reuses requestId while uncertain).
    const execute = vi.fn(async () => ({
      ok: false,
      error: "Move couldn't be saved — try again.",
      uncertain: true,
      sequence: 11,
    }));

    const first = await withGameActionIdempotency('room1', 'seat-a', 'uncertain-req', execute);
    const second = await withGameActionIdempotency('room1', 'seat-a', 'uncertain-req', execute);

    expect(first).toEqual({
      ok: false,
      error: "Move couldn't be saved — try again.",
      uncertain: true,
      sequence: 11,
    });
    expect(second).toEqual({
      ok: false,
      error: "Move couldn't be saved — try again.",
      uncertain: true,
      sequence: 11,
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(persistRoomCommandReceipt).not.toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'uncertain-req' }),
    );
    expect(getGameActionIdempotencyCacheSize('room1')).toBe(0);
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

  it('survives process-local cache clear via snapshot hydrate (restart simulation)', async () => {
    await withGameActionIdempotency('ROOM42', 'seat-a', 'restart-req', async () => ({
      ok: true,
      sequence: 44,
    }));
    const receipts = snapshotGameActionReceiptsForRoom('ROOM42');
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.requestId).toBe('restart-req');

    resetGameActionIdempotencyForTests();
    expect(getGameActionIdempotencyCacheSize('ROOM42')).toBe(0);

    const restored = hydrateGameActionReceiptsForRoom('ROOM42', receipts);
    expect(restored).toBe(1);

    let mutations = 0;
    const ack = await withGameActionIdempotency('ROOM42', 'seat-a', 'restart-req', async () => {
      mutations += 1;
      return { ok: true, sequence: 99 };
    });
    expect(mutations).toBe(0);
    expect(ack).toEqual({ ok: true, sequence: 44, duplicate: true });
  });
});
