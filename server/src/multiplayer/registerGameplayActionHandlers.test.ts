import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../game/types';
import * as rooms from '../rooms';
import { createReservedRoom, getRoom, joinRoom, resetRoomRuntimeForTests } from '../rooms';
import {
  hydrateGameActionReceiptsForRoom,
  resetGameActionIdempotencyForTests,
  snapshotGameActionReceiptsForRoom,
} from './gameActionIdempotency';
import {
  ensureSocketDataSeat,
  initRoomSession,
  resetRoomSessionStoresForTests,
  setRoomRoster,
} from './roomSession';
import * as roomSession from './roomSession';
import * as livePersistence from './roomLivePersistence';
import * as operationalTelemetry from '../operationalTelemetry';
import { registerGameplayActionHandlers } from './registerGameplayActionHandlers';
import { resetRoomGameplayLocksForTests } from './roomGameplayLock';

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

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

  // MP-JIT-1: a mid-hand move broadcasts immediately from authoritative in-memory
  // state; the room snapshot persist runs off the critical path. A persist that
  // cannot be proven durable does NOT roll back the move (that would desync the
  // already-broadcast clients) — it is recorded via operational telemetry.
  it('broadcasts a mid-hand move immediately and does not roll back when the async persist is not durably recoverable', async () => {
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
    const sequenceBefore = room.state.sequence;

    const io = makeIo();
    const { socket, handlers } = makeSocket('sock-1', seatId);
    ensureSocketDataSeat(socket, seatId);

    const actSpy = vi.spyOn(rooms, 'act').mockImplementation(async () => {
      room.state!.sequence += 1;
      room.state!.consecutivePasses += 1;
      return { room, forcedDrawAnimation: undefined };
    });
    const rollbackSpy = vi.spyOn(rooms, 'rollbackRoomGameplayCommit');
    const broadcastSpy = vi.spyOn(roomSession, 'broadcastStateUpdate').mockImplementation(() => {});
    vi.spyOn(livePersistence, 'flushScheduledLiveRoomPersistence').mockResolvedValue({
      flushedRoomCodes: ['ACKUNK'],
    });
    vi.spyOn(livePersistence, 'isLiveRoomDurablyRecoverable').mockReturnValue(false);
    vi.spyOn(livePersistence, 'isLiveRoomPersistenceShuttingDown').mockReturnValue(false);
    const telemetrySpy = vi
      .spyOn(operationalTelemetry, 'recordOperationalFailure')
      .mockImplementation(() => {});

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
    await handlers.get('game:action')?.(roomCode, payload, ack1);
    await flushMicrotasks();

    expect(actSpy).toHaveBeenCalledTimes(1);
    expect(rollbackSpy).not.toHaveBeenCalled();
    expect(broadcastSpy).toHaveBeenCalledWith(roomCode);
    expect(room.state.sequence).toBe(sequenceBefore + 1);
    expect(ack1).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, sequence: sequenceBefore + 1 }),
    );
    expect(telemetrySpy).toHaveBeenCalledWith(
      'live_room_move_persist_uncommitted',
      expect.anything(),
      expect.objectContaining({ roomCode }),
    );
  });

  it('a terminal (hand-over) move keeps the synchronous persist gate and rolls back on failure', async () => {
    const roomCode = 'ACKTERM';
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
    const sequenceBefore = room.state.sequence;

    const io = makeIo();
    const { socket, handlers } = makeSocket('sock-1', seatId);
    ensureSocketDataSeat(socket, seatId);

    const actSpy = vi.spyOn(rooms, 'act').mockImplementation(async () => {
      room.state!.sequence += 1;
      room.state!.handOver = true; // terminal move
      return { room, forcedDrawAnimation: undefined };
    });
    const rollbackSpy = vi.spyOn(rooms, 'rollbackRoomGameplayCommit');
    const broadcastSpy = vi.spyOn(roomSession, 'broadcastStateUpdate').mockImplementation(() => {});
    vi.spyOn(livePersistence, 'flushScheduledLiveRoomPersistence').mockResolvedValue({
      flushedRoomCodes: [roomCode],
    });
    vi.spyOn(livePersistence, 'isLiveRoomDurablyRecoverable').mockReturnValue(false);
    vi.spyOn(livePersistence, 'isLiveRoomPersistenceShuttingDown').mockReturnValue(false);

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

    const ack1 = vi.fn();
    await handlers.get('game:action')?.(
      roomCode,
      { type: 'MOVE', requestId: 'term-move', move: { tile: t(6, 5), position: 'left' } },
      ack1,
    );

    expect(actSpy).toHaveBeenCalledTimes(1);
    expect(rollbackSpy).toHaveBeenCalledTimes(1);
    expect(broadcastSpy).not.toHaveBeenCalled();
    expect(ack1).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, uncertain: true, sequence: sequenceBefore }),
    );
  });

  it('graceful shutdown forces the synchronous gate even for a mid-hand move', async () => {
    const roomCode = 'ACKSHUT';
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
    const sequenceBefore = room.state.sequence;

    const io = makeIo();
    const { socket, handlers } = makeSocket('sock-1', seatId);
    ensureSocketDataSeat(socket, seatId);

    vi.spyOn(rooms, 'act').mockImplementation(async () => {
      room.state!.sequence += 1;
      return { room, forcedDrawAnimation: undefined };
    });
    const rollbackSpy = vi.spyOn(rooms, 'rollbackRoomGameplayCommit');
    const broadcastSpy = vi.spyOn(roomSession, 'broadcastStateUpdate').mockImplementation(() => {});
    vi.spyOn(livePersistence, 'flushScheduledLiveRoomPersistence').mockResolvedValue({
      flushedRoomCodes: [roomCode],
    });
    vi.spyOn(livePersistence, 'isLiveRoomDurablyRecoverable').mockReturnValue(false);
    vi.spyOn(livePersistence, 'isLiveRoomPersistenceShuttingDown').mockReturnValue(true);

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

    const ack1 = vi.fn();
    await handlers.get('game:action')?.(
      roomCode,
      { type: 'PASS', requestId: 'shutdown-pass' },
      ack1,
    );

    expect(rollbackSpy).toHaveBeenCalledTimes(1);
    expect(broadcastSpy).not.toHaveBeenCalled();
    expect(ack1).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, uncertain: true, sequence: sequenceBefore }),
    );
  });

  it('consecutive mid-hand moves during a persist outage keep broadcasting and advancing; telemetry fires each time', async () => {
    const roomCode = 'ACKDBL';
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
    const sequenceBefore = room.state.sequence;

    const io = makeIo();
    const { socket, handlers } = makeSocket('sock-1', seatId);
    ensureSocketDataSeat(socket, seatId);

    const actSpy = vi.spyOn(rooms, 'act').mockImplementation(async () => {
      room.state!.sequence += 1;
      return { room, forcedDrawAnimation: undefined };
    });
    const rollbackSpy = vi.spyOn(rooms, 'rollbackRoomGameplayCommit');
    const broadcastSpy = vi.spyOn(roomSession, 'broadcastStateUpdate').mockImplementation(() => {});
    vi.spyOn(livePersistence, 'flushScheduledLiveRoomPersistence').mockResolvedValue({
      flushedRoomCodes: ['ACKDBL'],
    });
    const recoverableSpy = vi
      .spyOn(livePersistence, 'isLiveRoomDurablyRecoverable')
      .mockReturnValue(false);
    vi.spyOn(livePersistence, 'isLiveRoomPersistenceShuttingDown').mockReturnValue(false);
    const telemetrySpy = vi
      .spyOn(operationalTelemetry, 'recordOperationalFailure')
      .mockImplementation(() => {});

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

    for (let i = 0; i < 3; i += 1) {
      const ack = vi.fn();
      await handlers.get('game:action')?.(
        roomCode,
        { type: 'PASS', requestId: `outage-pass-${i}` },
        ack,
      );
      expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    }
    await flushMicrotasks();

    expect(actSpy).toHaveBeenCalledTimes(3);
    expect(rollbackSpy).not.toHaveBeenCalled();
    expect(broadcastSpy).toHaveBeenCalledTimes(3);
    expect(room.state.sequence).toBe(sequenceBefore + 3);
    expect(telemetrySpy).toHaveBeenCalledTimes(3);

    // Persistence recovers: next move's async gate resolves durable.
    recoverableSpy.mockReturnValue(true);
    const ackOk = vi.fn();
    await handlers.get('game:action')?.(
      roomCode,
      { type: 'PASS', requestId: 'outage-pass-ok' },
      ackOk,
    );
    await flushMicrotasks();
    expect(actSpy).toHaveBeenCalledTimes(4);
    expect(room.state.sequence).toBe(sequenceBefore + 4);
    expect(ackOk).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
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

  it('game:action PASS replays original ack after simulated ack-loss/reconnect, without re-mutating', async () => {
    const roomCode = 'RECONN1';
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
      flushedRoomCodes: [roomCode],
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
    vi.spyOn(roomSession, 'broadcastStateUpdate').mockImplementation(() => {});

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

    const payload = { type: 'PASS', requestId: 'reconn-pass-1' };
    const ack1 = vi.fn();
    // Client sends PASS but the ack never arrives (e.g. socket drops before the callback fires).
    await handlers.get('game:action')?.(roomCode, payload, ack1);
    expect(ack1).toHaveBeenCalledWith(expect.objectContaining({ ok: true, sequence: 6 }));

    // Simulate a process restart / cold reconnect: the in-memory idempotency cache is wiped,
    // and only the durably persisted receipt survives to be rehydrated.
    const receipts = snapshotGameActionReceiptsForRoom(roomCode);
    resetGameActionIdempotencyForTests();
    hydrateGameActionReceiptsForRoom(roomCode, receipts);

    // Client reconnects and resends the same logical PASS with the same requestId.
    const ack2 = vi.fn();
    await handlers.get('game:action')?.(roomCode, payload, ack2);

    expect(actSpy).toHaveBeenCalledTimes(1);
    expect(ack2).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, sequence: 6, duplicate: true }),
    );
    expect(getRoom(roomCode).state!.sequence).toBe(6);
  });
});
