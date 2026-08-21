/**
 * M3 — concurrent match start must not double-deal.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createReservedRoom,
  getRoom,
  joinRoom,
  resetRoomRuntimeForTests,
  RoomLifecyclePersistUncertainError,
  startGame,
} from '../rooms';
import * as livePersistence from './roomLivePersistence';
import { markMatchStartReady, tryStartMatchIfReady } from './matchStartReady';
import { resetRoomGameplayLocksForTests } from './roomGameplayLock';
import { initRoomSession, resetRoomSessionStoresForTests } from './roomSession';

function makeIo() {
  return {
    sockets: { sockets: new Map(), adapter: { rooms: new Map() } },
    to: vi.fn(() => ({ emit: vi.fn(), except: vi.fn(() => ({ emit: vi.fn() })) })),
  } as any;
}

describe('M3 concurrent match start lock', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetRoomRuntimeForTests();
    resetRoomGameplayLocksForTests();
    resetRoomSessionStoresForTests();
    initRoomSession(makeIo(), {
      resolveSocketIdentity: async () => ({ username: 'P1', userId: 'u1' }),
      normalizeUsername: (v) => String(v ?? 'Guest'),
      normalizeUserId: (v) => (typeof v === 'string' ? v : null),
      tryHydrateMatchmakingRoomShell: async () => 'skipped',
      waitUntilMatchmakingRoomSocketsReady: async () => undefined,
      onAfterMatchStarted: async () => undefined,
      notifyRoomPlayersInGame: () => undefined,
      persistRoomMatchLog: async () => undefined,
      onGameOver: () => null,
    });
  });

  it('1) two concurrent start signals → exactly one deal; second coalesces', async () => {
    const roomCode = 'M3C1';
    createReservedRoom(roomCode, { skipPregameDraw: true });
    joinRoom(roomCode, 'seat-1');
    joinRoom(roomCode, 'seat-2');
    const room = getRoom(roomCode);
    room.players = ['seat-1', 'seat-2'];
    room.state = null;
    markMatchStartReady(roomCode, 'seat-1');
    markMatchStartReady(roomCode, 'seat-2');

    const io = makeIo();
    const broadcast = vi.fn();
    const deps = { broadcastStateUpdate: broadcast };

    const [a, b] = await Promise.all([
      tryStartMatchIfReady(roomCode, io, deps),
      tryStartMatchIfReady(roomCode, io, deps),
    ]);

    const startedCount = [a, b].filter((r) => r.started).length;
    expect(startedCount).toBe(1);
    expect([a, b].some((r) => !r.started)).toBe(true);
    expect(room.state).not.toBeNull();
    expect(room.state!.handNumber).toBe(1);
    // One successful start broadcasts once (coalesced path does not re-broadcast).
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('2) first start flush fails (A1 rollback) → lock releases; retry starts normally', async () => {
    const roomCode = 'M3R1';
    createReservedRoom(roomCode, { skipPregameDraw: true });
    joinRoom(roomCode, 'seat-1');
    joinRoom(roomCode, 'seat-2');
    const room = getRoom(roomCode);
    room.players = ['seat-1', 'seat-2'];
    room.state = null;
    room.config = { ...room.config, skipPregameDraw: true };
    markMatchStartReady(roomCode, 'seat-1');
    markMatchStartReady(roomCode, 'seat-2');

    const io = makeIo();
    vi.spyOn(livePersistence, 'flushScheduledLiveRoomPersistence').mockResolvedValue({
      flushedRoomCodes: [roomCode],
    });
    let attempts = 0;
    vi.spyOn(livePersistence, 'isLiveRoomDurablyRecoverable').mockImplementation(() => {
      if (room.state !== null) {
        attempts += 1;
        return attempts > 1;
      }
      return true;
    });

    await expect(tryStartMatchIfReady(roomCode, io, { broadcastStateUpdate: vi.fn() })).rejects.toBeInstanceOf(
      RoomLifecyclePersistUncertainError,
    );
    expect(room.state).toBeNull();

    // Ready set restored by A1 rollback — re-mark if needed and retry under released lock.
    markMatchStartReady(roomCode, 'seat-1');
    markMatchStartReady(roomCode, 'seat-2');
    const retry = await tryStartMatchIfReady(roomCode, io, { broadcastStateUpdate: vi.fn() });
    expect(retry).toEqual({ started: true });
    expect(room.state).not.toBeNull();
    expect(room.state!.handOver).toBe(false);
  });

  it('3) sequential start still works unchanged', async () => {
    const roomCode = 'M3S1';
    createReservedRoom(roomCode, { skipPregameDraw: true });
    joinRoom(roomCode, 'seat-1');
    joinRoom(roomCode, 'seat-2');
    const room = getRoom(roomCode);
    room.players = ['seat-1', 'seat-2'];
    room.state = null;
    markMatchStartReady(roomCode, 'seat-1');

    const io = makeIo();
    const waiting = await tryStartMatchIfReady(roomCode, io, { broadcastStateUpdate: vi.fn() });
    expect(waiting).toEqual({ started: false, waitingFor: ['seat-2'] });
    expect(room.state).toBeNull();

    markMatchStartReady(roomCode, 'seat-2');
    const started = await tryStartMatchIfReady(roomCode, io, { broadcastStateUpdate: vi.fn() });
    expect(started).toEqual({ started: true });
    expect(room.state).not.toBeNull();

    const again = await tryStartMatchIfReady(roomCode, io, { broadcastStateUpdate: vi.fn() });
    expect(again).toEqual({ started: false });
    const handAfter = room.state!.handNumber;
    // Locked public startGame also coalesces instead of double-dealing.
    await startGame(roomCode, io);
    expect(room.state!.handNumber).toBe(handAfter);
  });
});
