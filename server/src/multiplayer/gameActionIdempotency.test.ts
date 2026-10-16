import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./roomCommandReceiptStore', () => ({
  persistRoomCommandReceipt: vi.fn(async () => undefined),
  deleteRoomCommandReceiptsForRoom: vi.fn(async () => undefined),
}));

import {
  clearGameActionIdempotencyForRoom,
  fingerprintGameCommand,
  lookupGameActionReceipt,
  REQUEST_ID_CONFLICT_ERROR,
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

  describe('command identity (request id + payload fingerprint)', () => {
    const fpA = fingerprintGameCommand('game:action', { type: 'MOVE', move: { tile: { high: 6, low: 5 }, position: 'left' }, requestId: 'r1' });
    const fpB = fingerprintGameCommand('game:action', { type: 'MOVE', move: { tile: { high: 6, low: 4 }, position: 'left' }, requestId: 'r1' });

    it('digests the command, not the request id', () => {
      expect(fingerprintGameCommand('game:action', { type: 'PASS', requestId: 'a' })).toBe(
        fingerprintGameCommand('game:action', { type: 'PASS', requestId: 'b' }),
      );
      expect(fpA).not.toBe(fpB);
      expect(fingerprintGameCommand('hand:ready', { handNumber: 1 })).not.toBe(fingerprintGameCommand('hand:ready', { handNumber: 2 }));
    });

    it('the legacy `end` alias is fingerprinted with the engine\'s precedence', () => {
      const viaEnd = (end: string) => fingerprintGameCommand('game:action', { type: 'MOVE', move: { tile: { high: 6, low: 5 }, end } });
      expect(viaEnd('left')).not.toBe(viaEnd('right'));
      expect(viaEnd('left')).toBe(fingerprintGameCommand('game:action', { type: 'MOVE', move: { tile: { high: 6, low: 5 }, position: 'left' } }));
    });

    it('same id + same payload replays the original result; same id + different payload fails closed without executing', async () => {
      let runs = 0;
      const exec = async () => { runs += 1; return { ok: true, sequence: 7 }; };
      const first = await withGameActionIdempotency('FP1', 's1', 'r1', exec, { fingerprint: fpA });
      const again = await withGameActionIdempotency('FP1', 's1', 'r1', exec, { fingerprint: fpA });
      const altered = await withGameActionIdempotency('FP1', 's1', 'r1', exec, { fingerprint: fpB });
      expect(first).toEqual({ ok: true, sequence: 7 });
      expect(again).toMatchObject({ ok: true, sequence: 7, duplicate: true });
      expect(again).not.toHaveProperty('fp');
      expect(altered).toEqual({ ok: false, error: REQUEST_ID_CONFLICT_ERROR });
      expect(runs).toBe(1);
    });

    it('conflict is detected against an in-flight execution too', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let runs = 0;
      const exec = async () => { runs += 1; await gate; return { ok: true, sequence: 1 }; };
      const p1 = withGameActionIdempotency('FP2', 's1', 'r1', exec, { fingerprint: fpA });
      const altered = await withGameActionIdempotency('FP2', 's1', 'r1', exec, { fingerprint: fpB });
      expect(altered).toEqual({ ok: false, error: REQUEST_ID_CONFLICT_ERROR });
      const p2 = withGameActionIdempotency('FP2', 's1', 'r1', exec, { fingerprint: fpA });
      release();
      expect(await p1).toMatchObject({ ok: true });
      expect(await p2).toMatchObject({ ok: true, duplicate: true });
      expect(runs).toBe(1);
    });

    it('the fingerprint survives restart: snapshot -> hydrate keeps rejecting an altered payload', async () => {
      await withGameActionIdempotency('FP3', 's1', 'r1', async () => ({ ok: true, sequence: 3 }), { fingerprint: fpA });
      const snapshot = snapshotGameActionReceiptsForRoom('FP3');
      expect(snapshot[0]?.ack.fp).toBe(fpA);
      resetGameActionIdempotencyForTests();
      expect(hydrateGameActionReceiptsForRoom('FP3', snapshot)).toBe(1);
      expect(lookupGameActionReceipt('FP3', 's1', 'r1', fpB)).toEqual({ ok: false, error: REQUEST_ID_CONFLICT_ERROR });
      expect(lookupGameActionReceipt('FP3', 's1', 'r1', fpA)).toMatchObject({ ok: true, sequence: 3, duplicate: true });
    });

    it('receipts written before fingerprints existed keep the id-only behavior', () => {
      hydrateGameActionReceiptsForRoom('FP4', [
        { playerSeatId: 's1', requestId: 'old', ack: { ok: true, sequence: 2 }, expiresAt: Date.now() + 60_000 },
      ]);
      expect(lookupGameActionReceipt('FP4', 's1', 'old', fpB)).toMatchObject({ ok: true, duplicate: true });
    });

    it('a valid no-op consumes no receipt (no cache entry, no durable row)', async () => {
      vi.mocked(persistRoomCommandReceipt).mockClear();
      const ack = await withGameActionIdempotency('FP5', 's1', 'noop-1', async () => ({ ok: true, noop: true }), { fingerprint: fpA });
      expect(ack).toEqual({ ok: true });
      expect(getGameActionIdempotencyCacheSize('FP5')).toBe(0);
      expect(persistRoomCommandReceipt).not.toHaveBeenCalled();
    });

    it('receipts persist the match they belong to', async () => {
      vi.mocked(persistRoomCommandReceipt).mockClear();
      await withGameActionIdempotency('FP6', 's1', 'r1', async () => ({ ok: true, sequence: 1 }), { fingerprint: fpA, matchId: 'match-A' });
      expect(persistRoomCommandReceipt).toHaveBeenCalledWith(expect.objectContaining({ matchId: 'match-A', ack: expect.objectContaining({ fp: fpA }) }));
    });
  });
});
