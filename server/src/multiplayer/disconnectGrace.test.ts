import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../game/types';
import * as engine from '../game/engine';
import * as rooms from '../rooms';
import { createReservedRoom, joinRoom, resetRoomRuntimeForTests } from '../rooms';
import { createHydratedRoomDurabilityState, captureRoomDurabilityFence } from './roomDurability';
import * as livePersistence from './roomLivePersistence';
import { initRoomSession, resetRoomSessionStoresForTests, clearRoomMetadata } from './roomSession';
import {
  configureDisconnectGraceSeatResolver,
  DISCONNECT_DURABILITY_MAX_RETRIES,
  DISCONNECT_DURABILITY_RETRY_MS,
  DISCONNECT_GRACE_MS,
  DISCONNECT_STALL_PAUSED_MESSAGE,
  DISCONNECT_STALL_RETRY_MESSAGE,
  getActiveDisconnectGracePlayerId,
  hasActiveDisconnectGrace,
  hasActiveDisconnectGraceForSeat,
  onActivePlayerSocketDisconnect,
  onPlayerSocketRejoined,
  resetDisconnectGraceForTests,
} from './disconnectGrace';

const t = (low: number, high: number) => ({ low: Math.min(low, high), high: Math.max(low, high) });

function mkGameState(currentPlayerIndex: number): GameState {
  return {
    config: {
      maxPips: 6,
      tilesPerPlayer: 7,
      deadTileCount: 2,
      scoringMultiple: 5,
      blockedHandRule: 'lowestPips',
      endHandBonus: 'sumOpponentPenalties',
      winningScore: 60,
    },
    playerIds: ['seat-a', 'seat-b'],
    players: {
      'seat-a': { id: 'seat-a', hand: [t(6, 5)], score: 0 },
      'seat-b': { id: 'seat-b', hand: [t(4, 4)], score: 0 },
    },
    board: { left: [t(6, 6)], right: [t(6, 3)] },
    boneyard: [t(1, 0)],
    deadTiles: [t(0, 0), t(1, 1)],
    currentPlayerIndex,
    handNumber: 1,
    handOpen: true,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 3,
  };
}

function seedLiveRoom(roomCode: string, currentPlayerIndex: number) {
  const room = createReservedRoom(roomCode);
  joinRoom(roomCode, 'seat-a');
  joinRoom(roomCode, 'seat-b');
  room.players = ['seat-a', 'seat-b'];
  room.state = mkGameState(currentPlayerIndex);
  room.disconnectExpiries = {};
  room.durability = createHydratedRoomDurabilityState(room, captureRoomDurabilityFence(room));
  return room;
}

function makeIo(socketConnected = false) {
  const roomEmit = vi.fn();
  return {
    io: {
      sockets: {
        sockets: new Map([
          [
            'sock-a',
            {
              id: 'sock-a',
              connected: socketConnected,
            },
          ],
        ]),
      },
      to: vi.fn(() => ({ emit: roomEmit })),
    } as any,
    roomEmit,
  };
}

describe('disconnectGrace', () => {
  let actSpy: ReturnType<typeof vi.spyOn>;
  let getLegalMovesSpy: ReturnType<typeof vi.spyOn>;
  let canDrawSpy: ReturnType<typeof vi.spyOn>;
  let flushSpy: ReturnType<typeof vi.spyOn>;
  let recoverableSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    resetRoomRuntimeForTests();
    resetDisconnectGraceForTests();
    resetRoomSessionStoresForTests();
    rooms.resetLiveRoomPersistHookForTests();
    actSpy = vi.spyOn(rooms, 'act').mockImplementation(async (code) => {
      const room = rooms.getRoom(code);
      if (room.state) {
        room.state = { ...room.state, sequence: room.state.sequence + 1 };
      }
      return {
        room,
        forcedDrawAnimation: undefined,
      };
    });
    getLegalMovesSpy = vi.spyOn(engine, 'getLegalMoves').mockReturnValue([{ type: 'pass' } as any]);
    canDrawSpy = vi.spyOn(engine, 'canDraw').mockReturnValue(false);
    flushSpy = vi.spyOn(livePersistence, 'flushScheduledLiveRoomPersistence').mockResolvedValue({
      flushedRoomCodes: ['TEST'],
    } as any);
    recoverableSpy = vi.spyOn(livePersistence, 'isLiveRoomDurablyRecoverable').mockReturnValue(true);
    configureDisconnectGraceSeatResolver(() => null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('starts grace timer when current player disconnects on their turn', () => {
    seedLiveRoom('GRACE1', 0);
    const { io, roomEmit } = makeIo();

    onActivePlayerSocketDisconnect('GRACE1', 'seat-a', io, vi.fn());

    expect(hasActiveDisconnectGrace('GRACE1')).toBe(true);
    expect(getActiveDisconnectGracePlayerId('GRACE1')).toBe('seat-a');
    expect(roomEmit).toHaveBeenCalledWith('player:disconnected', {
      playerId: 'seat-a',
      graceMs: DISCONNECT_GRACE_MS,
    });
  });

  it('clears grace timer on reconnect before timeout and performs no auto action', async () => {
    seedLiveRoom('GRACE2', 0);
    const { io, roomEmit } = makeIo();

    onActivePlayerSocketDisconnect('GRACE2', 'seat-a', io, vi.fn());
    onPlayerSocketRejoined('GRACE2', io, 'seat-a');

    expect(hasActiveDisconnectGrace('GRACE2')).toBe(false);
    expect(roomEmit).toHaveBeenCalledWith('player:reconnected', { playerId: 'seat-a' });

    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS);
    expect(actSpy).not.toHaveBeenCalled();
  });

  it('auto-passes when grace timer expires for disconnected current player', async () => {
    seedLiveRoom('GRACE3', 0);
    const broadcast = vi.fn();
    const { io } = makeIo(false);

    onActivePlayerSocketDisconnect('GRACE3', 'seat-a', io, broadcast);
    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS);

    expect(actSpy).toHaveBeenCalledWith(
      'GRACE3',
      'seat-a',
      { type: 'PASS' },
      io,
      broadcast,
    );
    expect(flushSpy).toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith('GRACE3');
    expect(hasActiveDisconnectGrace('GRACE3')).toBe(false);
  });

  it('auto-draws when pass is unavailable and draw is legal', async () => {
    getLegalMovesSpy.mockReturnValue([]);
    canDrawSpy.mockReturnValue(true);
    seedLiveRoom('GRACE4', 1);
    const broadcast = vi.fn();
    const { io } = makeIo(false);

    onActivePlayerSocketDisconnect('GRACE4', 'seat-b', io, broadcast);
    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS);

    expect(actSpy).toHaveBeenCalledWith(
      'GRACE4',
      'seat-b',
      { type: 'DRAW' },
      io,
      broadcast,
    );
  });

  it('does not auto-act when disconnected player is not on turn at expiry', async () => {
    seedLiveRoom('GRACE5', 1);
    const { io } = makeIo(false);

    onActivePlayerSocketDisconnect('GRACE5', 'seat-a', io, vi.fn());
    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS);

    expect(actSpy).not.toHaveBeenCalled();
  });

  it('does not leave stale timers across disconnect/reconnect cycles', async () => {
    seedLiveRoom('GRACE6', 0);
    const { io } = makeIo(false);

    onActivePlayerSocketDisconnect('GRACE6', 'seat-a', io, vi.fn());
    expect(hasActiveDisconnectGrace('GRACE6')).toBe(true);

    onPlayerSocketRejoined('GRACE6', io, 'seat-a');
    expect(hasActiveDisconnectGrace('GRACE6')).toBe(false);

    onActivePlayerSocketDisconnect('GRACE6', 'seat-a', io, vi.fn());
    expect(getActiveDisconnectGracePlayerId('GRACE6')).toBe('seat-a');

    onPlayerSocketRejoined('GRACE6', io, 'seat-a');
    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS);
    expect(actSpy).not.toHaveBeenCalled();
  });

  it('tracks grace timers per seat so reconnecting one player does not clear another player timer', async () => {
    const room = seedLiveRoom('GRACE_PER_SEAT', 0);
    const { io } = makeIo(false);

    onActivePlayerSocketDisconnect('GRACE_PER_SEAT', 'seat-a', io, vi.fn());
    room.state!.currentPlayerIndex = 1;
    onActivePlayerSocketDisconnect('GRACE_PER_SEAT', 'seat-b', io, vi.fn());

    expect(hasActiveDisconnectGraceForSeat('GRACE_PER_SEAT', 'seat-a')).toBe(true);
    expect(hasActiveDisconnectGraceForSeat('GRACE_PER_SEAT', 'seat-b')).toBe(true);

    onPlayerSocketRejoined('GRACE_PER_SEAT', io, 'seat-a');

    expect(hasActiveDisconnectGraceForSeat('GRACE_PER_SEAT', 'seat-a')).toBe(false);
    expect(hasActiveDisconnectGraceForSeat('GRACE_PER_SEAT', 'seat-b')).toBe(true);

    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS);

    expect(actSpy).toHaveBeenCalledTimes(1);
    expect(actSpy).toHaveBeenCalledWith(
      'GRACE_PER_SEAT',
      'seat-b',
      { type: 'PASS' },
      io,
      expect.any(Function),
    );
  });

  it('covers full disconnect and forfeit lifecycle on second expiry', async () => {
    const roomCode = 'GRACE_FORFEIT';
    const room = seedLiveRoom(roomCode, 0);

    const sessionDeps = {
      resolveSocketIdentity: async () => ({ username: 'Test', userId: 'test-user' }),
      normalizeUsername: (v: any) => String(v ?? 'Guest'),
      normalizeUserId: (v: any) => (typeof v === 'string' ? v : null),
      tryHydrateMatchmakingRoomShell: async () => 'skipped' as const,
      waitUntilMatchmakingRoomSocketsReady: async () => undefined,
      onAfterMatchStarted: async () => undefined,
      notifyRoomPlayersInGame: () => undefined,
      persistRoomMatchLog: async () => undefined,
      onGameOver: () => null,
    };

    const { io, roomEmit } = makeIo(false);
    initRoomSession(io, sessionDeps);

    onActivePlayerSocketDisconnect(roomCode, 'seat-a', io, vi.fn());
    expect(hasActiveDisconnectGrace(roomCode)).toBe(true);

    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS);
    expect(actSpy).toHaveBeenCalledTimes(1);
    expect(room.disconnectExpiries?.['seat-a']).toBe(1);
    expect(hasActiveDisconnectGrace(roomCode)).toBe(false);

    onActivePlayerSocketDisconnect(roomCode, 'seat-a', io, vi.fn());
    expect(hasActiveDisconnectGrace(roomCode)).toBe(true);

    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS);
    await vi.waitFor(() => {
      expect(room.disconnectExpiries?.['seat-a']).toBe(2);
      expect(room.abandonedAt).toBeDefined();
      expect(roomEmit).toHaveBeenCalledWith('room:match_abandoned', expect.any(Object));
    }, { timeout: 1000, interval: 20 });

    resetRoomSessionStoresForTests();
    rooms.resetLiveRoomPersistHookForTests();
  });

  it('handles reconnect after first expiry but before room cleanup', async () => {
    const roomCode = 'GRACE_RECONNECT';
    const room = seedLiveRoom(roomCode, 0);

    const { io } = makeIo(false);

    onActivePlayerSocketDisconnect(roomCode, 'seat-a', io, vi.fn());
    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS);
    expect(room.disconnectExpiries?.['seat-a']).toBe(1);

    onPlayerSocketRejoined(roomCode, io, 'seat-a');
    expect(room.disconnectExpiries?.['seat-a']).toBe(0);
    expect(hasActiveDisconnectGrace(roomCode)).toBe(false);
  });

  it('clears disconnect grace timer when room metadata is cleared (cleanup)', () => {
    const roomCode = 'GRACE_CLEANUP';
    seedLiveRoom(roomCode, 0);
    const { io } = makeIo();

    onActivePlayerSocketDisconnect(roomCode, 'seat-a', io, vi.fn());
    expect(hasActiveDisconnectGrace(roomCode)).toBe(true);

    clearRoomMetadata(roomCode);

    expect(hasActiveDisconnectGrace(roomCode)).toBe(false);
  });

  it('rolls back auto-act and emits stall retry when flush is not durably recoverable', async () => {
    const room = seedLiveRoom('GRACE_FLUSH_FAIL', 0);
    const sequenceBefore = room.state!.sequence;
    const broadcast = vi.fn();
    const rollbackSpy = vi.spyOn(rooms, 'rollbackRoomGameplayCommit');
    recoverableSpy.mockReturnValue(false);
    const { io, roomEmit } = makeIo(false);

    onActivePlayerSocketDisconnect('GRACE_FLUSH_FAIL', 'seat-a', io, broadcast);
    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS);

    expect(actSpy).toHaveBeenCalledTimes(1);
    expect(rollbackSpy).toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
    expect(room.disconnectExpiries?.['seat-a'] ?? 0).toBe(0);
    expect(roomEmit).toHaveBeenCalledWith('player:disconnect_stall', {
      playerId: 'seat-a',
      phase: 'retry',
      message: DISCONNECT_STALL_RETRY_MESSAGE,
    });
    expect(hasActiveDisconnectGrace('GRACE_FLUSH_FAIL')).toBe(true);
    expect(room.state!.sequence).toBe(sequenceBefore);
  });

  it('skips act and emits stall when durability already blocks gameplay', async () => {
    const room = seedLiveRoom('GRACE_PRE_FAIL', 0);
    room.durability = {
      ...room.durability,
      status: 'failed',
    };
    const broadcast = vi.fn();
    const { io, roomEmit } = makeIo(false);

    onActivePlayerSocketDisconnect('GRACE_PRE_FAIL', 'seat-a', io, broadcast);
    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS);

    expect(actSpy).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
    expect(roomEmit).toHaveBeenCalledWith('player:disconnect_stall', {
      playerId: 'seat-a',
      phase: 'retry',
      message: DISCONNECT_STALL_RETRY_MESSAGE,
    });
    expect(hasActiveDisconnectGrace('GRACE_PRE_FAIL')).toBe(true);
  });

  it('pauses after durability retry ceiling with no further timers or forfeit', async () => {
    const room = seedLiveRoom('GRACE_CEILING', 0);
    room.durability = {
      ...room.durability,
      status: 'failed',
    };
    const broadcast = vi.fn();
    const { io, roomEmit } = makeIo(false);

    onActivePlayerSocketDisconnect('GRACE_CEILING', 'seat-a', io, broadcast);
    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS);

    for (let i = 0; i < DISCONNECT_DURABILITY_MAX_RETRIES; i += 1) {
      await vi.advanceTimersByTimeAsync(DISCONNECT_DURABILITY_RETRY_MS);
    }

    expect(actSpy).not.toHaveBeenCalled();
    expect(room.abandonedAt).toBeUndefined();
    expect(room.disconnectExpiries?.['seat-a'] ?? 0).toBe(0);
    expect(roomEmit).toHaveBeenCalledWith('player:disconnect_stall', {
      playerId: 'seat-a',
      phase: 'paused',
      message: DISCONNECT_STALL_PAUSED_MESSAGE,
    });
    expect(hasActiveDisconnectGrace('GRACE_CEILING')).toBe(false);

    await vi.advanceTimersByTimeAsync(DISCONNECT_DURABILITY_RETRY_MS * 3);
    expect(actSpy).not.toHaveBeenCalled();
  });
});
