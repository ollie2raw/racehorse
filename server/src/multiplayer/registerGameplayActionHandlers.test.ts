import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../game/types';
import * as rooms from '../rooms';
import { createReservedRoom, getRoom, joinRoom, resetRoomRuntimeForTests } from '../rooms';
import { resetGameActionIdempotencyForTests } from './gameActionIdempotency';
import {
  ensureSocketDataSeat,
  initRoomSession,
  resetRoomSessionStoresForTests,
  setRoomRoster,
} from './roomSession';
import * as roomSession from './roomSession';
import * as livePersistence from './roomLivePersistence';
import { registerGameplayActionHandlers } from './registerGameplayActionHandlers';
import { resetRoomGameplayLocksForTests } from './roomGameplayLock';

const t = (low: number, high: number) => ({ low: Math.min(low, high), high: Math.max(low, high) });

function mkStartedRoom(roomCode: string): GameState {
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
    playerIds: ['seat-1', 'seat-2'],
    players: {
      'seat-1': { id: 'seat-1', hand: [t(6, 5)], score: 0 },
      'seat-2': { id: 'seat-2', hand: [t(4, 4)], score: 0 },
    },
    board: null,
    boneyard: [t(1, 0)],
    deadTiles: [t(0, 0), t(1, 1)],
    currentPlayerIndex: 0,
    handNumber: 1,
    handOpen: true,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 5,
  };
}

function makeSocket(socketId: string, seatId: string) {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const socket = {
    id: socketId,
    data: { playerId: seatId } as Record<string, unknown>,
    rooms: new Set<string>([socketId]),
    on: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return socket;
    },
    emit: vi.fn(),
  };
  return { socket: socket as any, handlers };
}

function makeIo() {
  return {
    sockets: { sockets: new Map(), adapter: { rooms: new Map() } },
    to: vi.fn(() => ({ emit: vi.fn(), except: vi.fn(() => ({ emit: vi.fn() })) })),
  } as any;
}

describe('registerGameplayActionHandlers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    resetRoomGameplayLocksForTests();
    resetGameActionIdempotencyForTests();
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

  it('game:action rejects unknown action types', async () => {
    const roomCode = 'ACT1';
    createReservedRoom(roomCode);
    const seatId = 'seat-1';
    joinRoom(roomCode, seatId);
    setRoomRoster(roomCode, [{ id: seatId, socketId: 'sock-1', username: 'P1', userId: 'u1' }]);

    const io = makeIo();
    const { socket, handlers } = makeSocket('sock-1', seatId);
    ensureSocketDataSeat(socket, seatId);
    const maybeFinalizeTournamentMatch = vi.fn();
    registerGameplayActionHandlers(io, socket, {
      handlerDeps: {
        resolveSocketIdentity: async () => ({ username: 'P1', userId: 'u1' }),
        normalizeUsername: (v) => String(v ?? 'Guest'),
        normalizeUserId: (v) => (typeof v === 'string' ? v : null),
        tryHydrateMatchmakingRoomShell: async () => 'skipped',
        waitUntilMatchmakingRoomSocketsReady: async () => undefined,
        onAfterMatchStarted: async () => undefined,
        notifyRoomPlayersInGame: () => undefined,
        persistRoomMatchLog: async () => undefined,
        maybeFinalizeTournamentMatch,
      },
    });

    const cb = vi.fn();
    await handlers.get('game:action')?.(roomCode, { type: 'INVALID' }, cb);
    expect(cb).toHaveBeenCalledWith({ ok: false, error: 'Unknown action type.' });
    expect(maybeFinalizeTournamentMatch).not.toHaveBeenCalled();
  });

  it('hand:ready rejects when the game has not started', async () => {
    const roomCode = 'HRDY1';
    createReservedRoom(roomCode);
    const seatId = 'seat-1';
    joinRoom(roomCode, seatId);
    setRoomRoster(roomCode, [{ id: seatId, socketId: 'sock-1', username: 'P1', userId: 'u1' }]);

    const io = makeIo();
    const { socket, handlers } = makeSocket('sock-1', seatId);
    ensureSocketDataSeat(socket, seatId);
    const maybeFinalizeTournamentMatch = vi.fn();
    registerGameplayActionHandlers(io, socket, {
      handlerDeps: {
        resolveSocketIdentity: async () => ({ username: 'P1', userId: 'u1' }),
        normalizeUsername: (v) => String(v ?? 'Guest'),
        normalizeUserId: (v) => (typeof v === 'string' ? v : null),
        tryHydrateMatchmakingRoomShell: async () => 'skipped',
        waitUntilMatchmakingRoomSocketsReady: async () => undefined,
        onAfterMatchStarted: async () => undefined,
        notifyRoomPlayersInGame: () => undefined,
        persistRoomMatchLog: async () => undefined,
        maybeFinalizeTournamentMatch,
      },
    });

    const cb = vi.fn();
    await handlers.get('hand:ready')?.(roomCode, undefined, cb);
    expect(cb).toHaveBeenCalledWith({ ok: false, error: 'Game not started.' });
    expect(maybeFinalizeTournamentMatch).not.toHaveBeenCalled();
  });

  it('game:action rejects valid action types when requestId is missing', async () => {
    const roomCode = 'REQID1';
    createReservedRoom(roomCode);
    const seatId = 'seat-1';
    joinRoom(roomCode, seatId);
    joinRoom(roomCode, 'seat-2');
    const room = getRoom(roomCode);
    room.players = [seatId, 'seat-2'];
    room.state = mkStartedRoom(roomCode);
    setRoomRoster(roomCode, [{ id: seatId, socketId: 'sock-1', username: 'P1', userId: 'u1' }]);

    const io = makeIo();
    const { socket, handlers } = makeSocket('sock-1', seatId);
    ensureSocketDataSeat(socket, seatId);
    const actSpy = vi.spyOn(rooms, 'act');

    registerGameplayActionHandlers(io, socket, {
      handlerDeps: {
        resolveSocketIdentity: async () => ({ username: 'P1', userId: 'u1' }),
        normalizeUsername: (v) => String(v ?? 'Guest'),
        normalizeUserId: (v) => (typeof v === 'string' ? v : null),
        tryHydrateMatchmakingRoomShell: async () => 'skipped',
        waitUntilMatchmakingRoomSocketsReady: async () => undefined,
        onAfterMatchStarted: async () => undefined,
        notifyRoomPlayersInGame: () => undefined,
        persistRoomMatchLog: async () => undefined,
        maybeFinalizeTournamentMatch: vi.fn(),
      },
    });

    const cb = vi.fn();
    await handlers.get('game:action')?.(roomCode, { type: 'PASS' }, cb);

    expect(cb).toHaveBeenCalledWith({ ok: false, error: 'Missing action requestId.' });
    expect(actSpy).not.toHaveBeenCalled();
  });

  it('game:action with duplicate requestId mutates only once and replays ack', async () => {
    const roomCode = 'IDEM1';
    createReservedRoom(roomCode);
    const seatId = 'seat-1';
    joinRoom(roomCode, seatId);
    joinRoom(roomCode, 'seat-2');
    const room = getRoom(roomCode);
    room.players = [seatId, 'seat-2'];
    room.state = mkStartedRoom(roomCode);
    setRoomRoster(roomCode, [{ id: seatId, socketId: 'sock-1', username: 'P1', userId: 'u1' }]);

    const io = makeIo();
    const { socket, handlers } = makeSocket('sock-1', seatId);
    ensureSocketDataSeat(socket, seatId);

    vi.spyOn(livePersistence, 'flushScheduledLiveRoomPersistence').mockResolvedValue({
      flushedRoomCodes: ['IDEM1'],
    });
    const actSpy = vi.spyOn(rooms, 'act').mockImplementation(async () => {
      room.state!.sequence += 1;
      const version = {
        asyncStateVersion: room.asyncStateVersion,
        stateSequence: room.state!.sequence,
        eventSequence: room.eventSequence,
      };
      const commitFence = { ...version, commitId: room.durability.targetFence.commitId };
      room.durability = {
        status: 'healthy',
        targetVersion: version,
        targetFence: commitFence,
        persistedVersion: version,
        persistedFence: commitFence,
        consecutiveFailures: 0,
        lastError: null,
        lastAttemptedAtMs: Date.now(),
        lastPersistedAtMs: Date.now(),
      };
      return { room, forcedDrawAnimation: undefined };
    });
    const broadcastSpy = vi.spyOn(roomSession, 'broadcastStateUpdate').mockImplementation(() => {});

    registerGameplayActionHandlers(io, socket, {
      handlerDeps: {
        resolveSocketIdentity: async () => ({ username: 'P1', userId: 'u1' }),
        normalizeUsername: (v) => String(v ?? 'Guest'),
        normalizeUserId: (v) => (typeof v === 'string' ? v : null),
        tryHydrateMatchmakingRoomShell: async () => 'skipped',
        waitUntilMatchmakingRoomSocketsReady: async () => undefined,
        onAfterMatchStarted: async () => undefined,
        notifyRoomPlayersInGame: () => undefined,
        persistRoomMatchLog: async () => undefined,
        maybeFinalizeTournamentMatch: vi.fn(),
      },
    });

    const payload = { type: 'PASS', requestId: 'idem-pass-1' };
    const ack1 = vi.fn();
    const ack2 = vi.fn();
    await handlers.get('game:action')?.(roomCode, payload, ack1);
    await handlers.get('game:action')?.(roomCode, payload, ack2);

    expect(actSpy).toHaveBeenCalledTimes(1);
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    expect(ack1).toHaveBeenCalledWith(expect.objectContaining({ ok: true, sequence: 6 }));
    expect(ack2).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, sequence: 6, duplicate: true }),
    );
    expect(getRoom(roomCode).state!.sequence).toBe(6);
  });

  it('blocks gameplay actions after room persistence failure', async () => {
    const roomCode = 'FAILACT';
    createReservedRoom(roomCode);
    const seatId = 'seat-1';
    joinRoom(roomCode, seatId);
    joinRoom(roomCode, 'seat-2');
    const room = getRoom(roomCode);
    room.players = [seatId, 'seat-2'];
    room.state = mkStartedRoom(roomCode);
    room.durability.status = 'failed';
    setRoomRoster(roomCode, [{ id: seatId, socketId: 'sock-1', username: 'P1', userId: 'u1' }]);

    const io = makeIo();
    const { socket, handlers } = makeSocket('sock-1', seatId);
    ensureSocketDataSeat(socket, seatId);

    registerGameplayActionHandlers(io, socket, {
      handlerDeps: {
        resolveSocketIdentity: async () => ({ username: 'P1', userId: 'u1' }),
        normalizeUsername: (v) => String(v ?? 'Guest'),
        normalizeUserId: (v) => (typeof v === 'string' ? v : null),
        tryHydrateMatchmakingRoomShell: async () => 'skipped',
        waitUntilMatchmakingRoomSocketsReady: async () => undefined,
        onAfterMatchStarted: async () => undefined,
        notifyRoomPlayersInGame: () => undefined,
        persistRoomMatchLog: async () => undefined,
        maybeFinalizeTournamentMatch: vi.fn(),
      },
    });

    const cb = vi.fn();
    await handlers.get('game:action')?.(roomCode, { type: 'PASS', requestId: 'failed-pass' }, cb);
    expect(cb).toHaveBeenCalledWith({ ok: false, error: 'room_persistence_failed' });
  });

  it('blocks hand:ready when room persistence is degraded', async () => {
    const roomCode = 'HNDBLK';
    createReservedRoom(roomCode);
    const seatId = 'seat-1';
    joinRoom(roomCode, seatId);
    joinRoom(roomCode, 'seat-2');
    const room = getRoom(roomCode);
    room.players = [seatId, 'seat-2'];
    room.state = {
      ...mkStartedRoom(roomCode),
      handOver: true,
      gameOver: false,
    };
    room.durability.status = 'degraded';
    setRoomRoster(roomCode, [{ id: seatId, socketId: 'sock-1', username: 'P1', userId: 'u1' }]);

    const io = makeIo();
    const { socket, handlers } = makeSocket('sock-1', seatId);
    ensureSocketDataSeat(socket, seatId);

    registerGameplayActionHandlers(io, socket, {
      handlerDeps: {
        resolveSocketIdentity: async () => ({ username: 'P1', userId: 'u1' }),
        normalizeUsername: (v) => String(v ?? 'Guest'),
        normalizeUserId: (v) => (typeof v === 'string' ? v : null),
        tryHydrateMatchmakingRoomShell: async () => 'skipped',
        waitUntilMatchmakingRoomSocketsReady: async () => undefined,
        onAfterMatchStarted: async () => undefined,
        notifyRoomPlayersInGame: () => undefined,
        persistRoomMatchLog: async () => undefined,
        maybeFinalizeTournamentMatch: vi.fn(),
      },
    });

    const cb = vi.fn();
    await handlers.get('hand:ready')?.(roomCode, room.state.handNumber, cb);
    expect(cb).toHaveBeenCalledWith({ ok: false, error: 'new_hand_blocked' });
  });

  it('returns an uncertain ack when a gameplay mutation cannot be proven durably committed', async () => {
    const roomCode = 'ACKUNK';
    createReservedRoom(roomCode);
    const seatId = 'seat-1';
    joinRoom(roomCode, seatId);
    joinRoom(roomCode, 'seat-2');
    const room = getRoom(roomCode);
    room.players = [seatId, 'seat-2'];
    room.state = mkStartedRoom(roomCode);
    room.durability.persistedFence = null;
    room.durability.status = 'healthy';
    setRoomRoster(roomCode, [{ id: seatId, socketId: 'sock-1', username: 'P1', userId: 'u1' }]);

    const io = makeIo();
    const { socket, handlers } = makeSocket('sock-1', seatId);
    ensureSocketDataSeat(socket, seatId);

    const actSpy = vi.spyOn(rooms, 'act').mockImplementation(async () => {
      room.state!.sequence += 1;
      return { room, forcedDrawAnimation: undefined };
    });
    vi.spyOn(livePersistence, 'flushScheduledLiveRoomPersistence').mockResolvedValue({
      flushedRoomCodes: ['ACKUNK'],
    });

    registerGameplayActionHandlers(io, socket, {
      handlerDeps: {
        resolveSocketIdentity: async () => ({ username: 'P1', userId: 'u1' }),
        normalizeUsername: (v) => String(v ?? 'Guest'),
        normalizeUserId: (v) => (typeof v === 'string' ? v : null),
        tryHydrateMatchmakingRoomShell: async () => 'skipped',
        waitUntilMatchmakingRoomSocketsReady: async () => undefined,
        onAfterMatchStarted: async () => undefined,
        notifyRoomPlayersInGame: () => undefined,
        persistRoomMatchLog: async () => undefined,
        maybeFinalizeTournamentMatch: vi.fn(),
      },
    });

    const payload = { type: 'PASS', requestId: 'uncertain-pass' };
    const ack1 = vi.fn();
    const ack2 = vi.fn();
    await handlers.get('game:action')?.(roomCode, payload, ack1);
    await handlers.get('game:action')?.(roomCode, payload, ack2);

    expect(actSpy).toHaveBeenCalledTimes(1);
    expect(ack1).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        uncertain: true,
        error: expect.stringMatching(/^room_(persistence_failed|snapshot_uncommitted)$/),
      }),
    );
    expect(ack2).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        uncertain: true,
        duplicate: true,
        error: expect.stringMatching(/^room_(persistence_failed|snapshot_uncommitted)$/),
      }),
    );
  });

  it('game:action MOVE with duplicate requestId mutates only once and replays ack', async () => {
    const roomCode = 'IDEM2';
    createReservedRoom(roomCode);
    const seatId = 'seat-1';
    joinRoom(roomCode, seatId);
    joinRoom(roomCode, 'seat-2');
    const room = getRoom(roomCode);
    room.players = [seatId, 'seat-2'];
    room.state = mkStartedRoom(roomCode);
    setRoomRoster(roomCode, [{ id: seatId, socketId: 'sock-1', username: 'P1', userId: 'u1' }]);

    const io = makeIo();
    const { socket, handlers } = makeSocket('sock-1', seatId);
    ensureSocketDataSeat(socket, seatId);

    vi.spyOn(livePersistence, 'flushScheduledLiveRoomPersistence').mockResolvedValue({
      flushedRoomCodes: ['IDEM2'],
    });
    const actSpy = vi.spyOn(rooms, 'act').mockImplementation(async () => {
      room.state!.sequence += 1;
      const version = {
        asyncStateVersion: room.asyncStateVersion,
        stateSequence: room.state!.sequence,
        eventSequence: room.eventSequence,
      };
      const commitFence = { ...version, commitId: room.durability.targetFence.commitId };
      room.durability = {
        status: 'healthy',
        targetVersion: version,
        targetFence: commitFence,
        persistedVersion: version,
        persistedFence: commitFence,
        consecutiveFailures: 0,
        lastError: null,
        lastAttemptedAtMs: Date.now(),
        lastPersistedAtMs: Date.now(),
      };
      return { room, forcedDrawAnimation: undefined };
    });
    const broadcastSpy = vi.spyOn(roomSession, 'broadcastStateUpdate').mockImplementation(() => {});

    registerGameplayActionHandlers(io, socket, {
      handlerDeps: {
        resolveSocketIdentity: async () => ({ username: 'P1', userId: 'u1' }),
        normalizeUsername: (v) => String(v ?? 'Guest'),
        normalizeUserId: (v) => (typeof v === 'string' ? v : null),
        tryHydrateMatchmakingRoomShell: async () => 'skipped',
        waitUntilMatchmakingRoomSocketsReady: async () => undefined,
        onAfterMatchStarted: async () => undefined,
        notifyRoomPlayersInGame: () => undefined,
        persistRoomMatchLog: async () => undefined,
        maybeFinalizeTournamentMatch: vi.fn(),
      },
    });

    const payload = {
      type: 'MOVE',
      requestId: 'idem-move-1',
      move: { tile: { low: 5, high: 6 }, position: 'right' },
    };
    const ack1 = vi.fn();
    const ack2 = vi.fn();
    await handlers.get('game:action')?.(roomCode, payload, ack1);
    await handlers.get('game:action')?.(roomCode, payload, ack2);

    expect(actSpy).toHaveBeenCalledTimes(1);
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    expect(ack1).toHaveBeenCalledWith(expect.objectContaining({ ok: true, sequence: 6 }));
    expect(ack2).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, sequence: 6, duplicate: true }),
    );
    expect(getRoom(roomCode).state!.sequence).toBe(6);
  });
});
