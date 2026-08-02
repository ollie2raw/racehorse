import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./roomCommandReceiptStore', () => ({
  persistRoomCommandReceipt: vi.fn(async () => undefined),
  deleteRoomCommandReceiptsForRoom: vi.fn(async () => undefined),
  loadRoomCommandReceiptsForRoom: vi.fn(async () => []),
}));

import { createReservedRoom, deleteRoom, resetRoomRuntimeForTests } from '../rooms';
import { applyLiveSessionRow } from './applyLiveSessionRoom';
import {
  getGameActionIdempotencyCacheSize,
  hydrateGameActionReceiptsForRoom,
  resetGameActionIdempotencyForTests,
  snapshotGameActionReceiptsForRoom,
  withGameActionIdempotency,
} from './gameActionIdempotency';
import { buildLiveSessionRow, parseRoomShell, serializeRoomShell } from './roomLivePersistence';
import { markRoomDurabilityPersistSuccess, captureRoomDurabilityFence } from './roomDurability';

describe('private session action receipt durability', () => {
  beforeEach(() => {
    resetRoomRuntimeForTests();
    resetGameActionIdempotencyForTests();
  });

  afterEach(() => {
    resetGameActionIdempotencyForTests();
    resetRoomRuntimeForTests();
  });

  it('round-trips receipts through room_shell serialize → parse → hydrate', async () => {
    const room = createReservedRoom('RCPT1', { winningScore: 30 });
    room.players = ['seat-a', 'seat-b'];
    room.state = {
      playerIds: ['seat-a', 'seat-b'],
      players: {
        'seat-a': { hand: [], score: 0 },
        'seat-b': { hand: [], score: 0 },
      },
      board: { tiles: [], leftEnd: null, rightEnd: null },
      boneyard: [],
      deadTiles: [],
      currentPlayerIndex: 0,
      handOver: false,
      gameOver: false,
      handNumber: 1,
      sequence: 3,
      winnerId: null,
      config: room.config,
    } as any;

    await withGameActionIdempotency('RCPT1', 'seat-a', 'durable-req-1', async () => ({
      ok: true,
      sequence: 3,
    }));
    expect(getGameActionIdempotencyCacheSize('RCPT1')).toBe(1);

    const fence = captureRoomDurabilityFence(room);
    markRoomDurabilityPersistSuccess(room, fence);
    const shell = serializeRoomShell(room);
    expect(shell.actionReceipts?.length).toBe(1);
    expect(shell.actionReceipts?.[0]?.requestId).toBe('durable-req-1');

    const parsed = parseRoomShell(shell);
    expect(parsed.actionReceipts?.length).toBe(1);

    resetGameActionIdempotencyForTests();
    expect(getGameActionIdempotencyCacheSize('RCPT1')).toBe(0);
    const restored = hydrateGameActionReceiptsForRoom('RCPT1', parsed.actionReceipts);
    expect(restored).toBe(1);

    let mutations = 0;
    const ack = await withGameActionIdempotency('RCPT1', 'seat-a', 'durable-req-1', async () => {
      mutations += 1;
      return { ok: true, sequence: 99 };
    });
    expect(mutations).toBe(0);
    expect(ack.duplicate).toBe(true);
    expect(ack.sequence).toBe(3);
  });

  it('restores receipts when applying a live-session row into a fresh process', async () => {
    const room = createReservedRoom('RCPT2', { winningScore: 30 });
    room.players = ['seat-a', 'seat-b'];
    room.state = {
      playerIds: ['seat-a', 'seat-b'],
      players: {
        'seat-a': { hand: [{ high: 6, low: 6 }], score: 0 },
        'seat-b': { hand: [{ high: 5, low: 5 }], score: 0 },
      },
      board: { tiles: [], leftEnd: null, rightEnd: null },
      boneyard: [],
      deadTiles: [],
      currentPlayerIndex: 0,
      handOver: false,
      gameOver: false,
      handNumber: 1,
      sequence: 4,
      winnerId: null,
      config: room.config,
    } as any;

    await withGameActionIdempotency('RCPT2', 'seat-b', 'hydrate-req', async () => ({
      ok: true,
      sequence: 4,
    }));
    const fence = captureRoomDurabilityFence(room);
    markRoomDurabilityPersistSuccess(room, fence);
    const row = buildLiveSessionRow(room, [
      { seatId: 'seat-a', userId: 'u1', username: 'A' },
      { seatId: 'seat-b', userId: 'u2', username: 'B' },
    ]);
    expect(row.room_shell.actionReceipts?.length).toBe(1);

    deleteRoom('RCPT2');
    resetGameActionIdempotencyForTests();
    expect(getGameActionIdempotencyCacheSize('RCPT2')).toBe(0);

    const applied = applyLiveSessionRow(row);
    expect(applied?.room.code).toBe('RCPT2');
    expect(getGameActionIdempotencyCacheSize('RCPT2')).toBe(1);

    let mutations = 0;
    const ack = await withGameActionIdempotency('RCPT2', 'seat-b', 'hydrate-req', async () => {
      mutations += 1;
      return { ok: true, sequence: 100 };
    });
    expect(mutations).toBe(0);
    expect(ack).toMatchObject({ ok: true, sequence: 4, duplicate: true });
  });
});
