/**
 * A1 — hand lifecycle mutate→flush→rollback (mirrors PR-MP-C game:action tests).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../game/types';
import {
  createReservedRoom,
  getRoom,
  HAND_LIFECYCLE_PERSIST_RETRY_MESSAGE,
  joinRoom,
  nextHand,
  resetRoomRuntimeForTests,
  RoomLifecyclePersistUncertainError,
  startGame,
} from '../rooms';
import { resetGameActionIdempotencyForTests } from './gameActionIdempotency';
import {
  ensureSocketDataSeat,
  initRoomSession,
  resetRoomSessionStoresForTests,
  setRoomRoster,
} from './roomSession';
import * as livePersistence from './roomLivePersistence';
import { registerGameplayActionHandlers } from './registerGameplayActionHandlers';
import { registerMatchStartHandlers } from './registerMatchStartHandlers';
import { resetRoomGameplayLocksForTests } from './roomGameplayLock';
import { markMatchStartReady } from './matchStartReady';

const t = (low: number, high: number) => ({ low: Math.min(low, high), high: Math.max(low, high) });

function mkHandOverState(handNumber = 1): GameState {
  return {
    config: {
      maxPips: 6,
      tilesPerPlayer: 7,
      deadTileCount: 2,
      scoringMultiple: 5,
      blockedHandRule: 'lowestPips',
      endHandBonus: 'sumOpponentPenalties',
      winningScore: 60,
      skipPregameDraw: true,
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
    handNumber,
    handOpen: false,
    handOver: true,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 8,
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

function makeIo(roomCode?: string, socketIds: string[] = []) {
  const roomMembers = new Set(socketIds);
  return {
    sockets: {
      sockets: new Map(),
      adapter: {
        rooms: new Map(roomCode ? [[roomCode, roomMembers]] : []),
      },
    },
    to: vi.fn(() => ({ emit: vi.fn(), except: vi.fn(() => ({ emit: vi.fn() })) })),
  } as any;
}

const handlerDeps = {
  resolveSocketIdentity: async () => ({ username: 'P1', userId: 'u1' }),
  normalizeUsername: (v: unknown) => String(v ?? 'Guest'),
  normalizeUserId: (v: unknown) => (typeof v === 'string' ? v : null),
  tryHydrateMatchmakingRoomShell: async () => 'skipped' as const,
  waitUntilMatchmakingRoomSocketsReady: async () => undefined,
  onAfterMatchStarted: async () => undefined,
  notifyRoomPlayersInGame: () => undefined,
  persistRoomMatchLog: async () => undefined,
  maybeFinalizeTournamentMatch: vi.fn(),
  onGameOver: () => null,
};

describe('A1 hand lifecycle persist rollback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    resetRoomGameplayLocksForTests();
    resetGameActionIdempotencyForTests();
    initRoomSession(makeIo(), handlerDeps);
  });

  it('1) hand:ready flush fails → rollback; client sees uncertain; ready set matches pre-mutation', async () => {
    const roomCode = 'A1HR1';
    createReservedRoom(roomCode, { skipPregameDraw: true });
    joinRoom(roomCode, 'seat-1');
    joinRoom(roomCode, 'seat-2');
    const room = getRoom(roomCode);
    room.players = ['seat-1', 'seat-2'];
    room.state = mkHandOverState();
    room.lastHandEndedAtMs = Date.now() - 10_000;
    setRoomRoster(roomCode, [
      { id: 'seat-1', socketId: 'sock-1', username: 'P1', userId: 'u1' },
    ]);

    const io = makeIo();
    const { socket, handlers } = makeSocket('sock-1', 'seat-1');
    ensureSocketDataSeat(socket, 'seat-1');
    registerGameplayActionHandlers(io, socket, { handlerDeps });

    vi.spyOn(livePersistence, 'flushScheduledLiveRoomPersistence').mockResolvedValue({
      flushedRoomCodes: [roomCode],
    });
    vi.spyOn(livePersistence, 'isLiveRoomDurablyRecoverable').mockReturnValue(false);

    const ack = vi.fn();
    await handlers.get('hand:ready')?.(
      roomCode,
      { handNumber: room.state.handNumber, requestId: 'a1-hr-flush-fail' },
      ack,
    );

    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        uncertain: true,
        error: HAND_LIFECYCLE_PERSIST_RETRY_MESSAGE,
      }),
    );
    expect([...room.nextHandReady]).toEqual([]);
    expect(room.state.handOver).toBe(true);
    expect(room.state.handNumber).toBe(1);
  });

  it('2) nextHand flush fails → rollback; no hand dealt that client does not know about', async () => {
    const roomCode = 'A1NH1';
    createReservedRoom(roomCode, { skipPregameDraw: true });
    joinRoom(roomCode, 'seat-1');
    joinRoom(roomCode, 'seat-2');
    const room = getRoom(roomCode);
    room.players = ['seat-1', 'seat-2'];
    room.state = mkHandOverState(2);
    room.nextHandReady = new Set(['seat-1', 'seat-2']);
    const handBefore = room.state.handNumber;
    const seqBefore = room.state.sequence;
    const asyncBefore = room.asyncStateVersion;

    const io = makeIo();
    vi.spyOn(livePersistence, 'flushScheduledLiveRoomPersistence').mockResolvedValue({
      flushedRoomCodes: [roomCode],
    });
    vi.spyOn(livePersistence, 'isLiveRoomDurablyRecoverable').mockReturnValue(false);

    await expect(nextHand(roomCode, io)).rejects.toBeInstanceOf(RoomLifecyclePersistUncertainError);

    expect(room.state.handNumber).toBe(handBefore);
    expect(room.state.handOver).toBe(true);
    expect(room.state.sequence).toBe(seqBefore);
    expect(room.asyncStateVersion).toBe(asyncBefore);
    expect([...room.nextHandReady].sort()).toEqual(['seat-1', 'seat-2']);
  });

  it('3) startGame flush fails → rollback; game not left half-started', async () => {
    const roomCode = 'A1SG1';
    createReservedRoom(roomCode, { skipPregameDraw: true });
    joinRoom(roomCode, 'seat-1');
    joinRoom(roomCode, 'seat-2');
    const room = getRoom(roomCode);
    room.players = ['seat-1', 'seat-2'];
    room.state = null;
    room.matchStartReady = new Set(['seat-1', 'seat-2']);
    const asyncBefore = room.asyncStateVersion;

    const io = makeIo();
    vi.spyOn(livePersistence, 'flushScheduledLiveRoomPersistence').mockResolvedValue({
      flushedRoomCodes: [roomCode],
    });
    vi.spyOn(livePersistence, 'isLiveRoomDurablyRecoverable').mockReturnValue(false);

    await expect(startGame(roomCode, io)).rejects.toBeInstanceOf(RoomLifecyclePersistUncertainError);

    expect(room.state).toBeNull();
    expect(room.asyncStateVersion).toBe(asyncBefore);
    expect([...room.matchStartReady].sort()).toEqual(['seat-1', 'seat-2']);
  });

  it('4) uncertain hand:ready→nextHand retry reconciles; does not double-deal', async () => {
    const roomCode = 'A1UNC';
    createReservedRoom(roomCode, { skipPregameDraw: true });
    joinRoom(roomCode, 'seat-1');
    joinRoom(roomCode, 'seat-2');
    const room = getRoom(roomCode);
    room.players = ['seat-1', 'seat-2'];
    room.state = mkHandOverState(3);
    room.lastHandEndedAtMs = Date.now() - 10_000;
    setRoomRoster(roomCode, [
      { id: 'seat-1', socketId: 'sock-1', username: 'P1', userId: 'u1' },
      { id: 'seat-2', socketId: 'sock-2', username: 'P2', userId: 'u2' },
    ]);

    const io = makeIo();
    const { socket: s1, handlers: h1 } = makeSocket('sock-1', 'seat-1');
    const { socket: s2, handlers: h2 } = makeSocket('sock-2', 'seat-2');
    ensureSocketDataSeat(s1, 'seat-1');
    ensureSocketDataSeat(s2, 'seat-2');
    registerGameplayActionHandlers(io, s1, { handlerDeps });
    registerGameplayActionHandlers(io, s2, { handlerDeps });

    vi.spyOn(livePersistence, 'flushScheduledLiveRoomPersistence').mockResolvedValue({
      flushedRoomCodes: [roomCode],
    });
    // Ready-mark flushes succeed; nextHand flush fails once, then recovers.
    let nextHandFlushAttempts = 0;
    const recoverableSpy = vi
      .spyOn(livePersistence, 'isLiveRoomDurablyRecoverable')
      .mockImplementation(() => {
        // After ready marks are committed, nextHand mutates handOver→false.
        // Fail the first nextHand commit only.
        if (room.state && !room.state.handOver) {
          nextHandFlushAttempts += 1;
          return nextHandFlushAttempts > 1;
        }
        return true;
      });

    const handBefore = room.state!.handNumber;

    const ack1 = vi.fn();
    await h1.get('hand:ready')?.(
      roomCode,
      { handNumber: handBefore, requestId: 'a1-unc-p1' },
      ack1,
    );
    expect(ack1).toHaveBeenCalledWith(expect.objectContaining({ ok: true, started: false }));

    const ackFail = vi.fn();
    await h2.get('hand:ready')?.(
      roomCode,
      { handNumber: handBefore, requestId: 'a1-unc-p2' },
      ackFail,
    );
    expect(ackFail).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        uncertain: true,
        error: HAND_LIFECYCLE_PERSIST_RETRY_MESSAGE,
      }),
    );
    expect(room.state!.handNumber).toBe(handBefore);
    expect(room.state!.handOver).toBe(true);
    expect([...room.nextHandReady].sort()).toEqual(['seat-1', 'seat-2']);

    // Same requestId retry after uncertain — must re-execute and succeed once.
    const ackRetry = vi.fn();
    await h2.get('hand:ready')?.(
      roomCode,
      { handNumber: handBefore, requestId: 'a1-unc-p2' },
      ackRetry,
    );
    expect(ackRetry).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, started: true }),
    );
    expect(room.state!.handNumber).toBe(handBefore + 1);
    expect(room.state!.handOver).toBe(false);

    // Duplicate success replay — must not advance again.
    const ackDup = vi.fn();
    await h2.get('hand:ready')?.(
      roomCode,
      { handNumber: handBefore, requestId: 'a1-unc-p2' },
      ackDup,
    );
    expect(ackDup).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, started: true, duplicate: true }),
    );
    expect(room.state!.handNumber).toBe(handBefore + 1);
    expect(recoverableSpy).toHaveBeenCalled();
  });

  it('5) game:start uncertain then retry with same requestId does not double-start', async () => {
    const roomCode = 'A1GS1';
    createReservedRoom(roomCode, { skipPregameDraw: true });
    joinRoom(roomCode, 'seat-1');
    joinRoom(roomCode, 'seat-2');
    const room = getRoom(roomCode);
    room.players = ['seat-1', 'seat-2'];
    room.state = null;
    room.config = { ...room.config, skipPregameDraw: true };
    setRoomRoster(roomCode, [
      { id: 'seat-1', socketId: 'sock-1', username: 'Host', userId: 'u1' },
      { id: 'seat-2', socketId: 'sock-2', username: 'Guest', userId: 'u2' },
    ]);
    markMatchStartReady(roomCode, 'seat-2');

    const io = makeIo(roomCode, ['sock-1', 'sock-2']);
    const { socket, handlers } = makeSocket('sock-1', 'seat-1');
    ensureSocketDataSeat(socket, 'seat-1');
    registerMatchStartHandlers(io, socket, { handlerDeps });

    vi.spyOn(livePersistence, 'flushScheduledLiveRoomPersistence').mockResolvedValue({
      flushedRoomCodes: [roomCode],
    });
    let startAttempts = 0;
    vi.spyOn(livePersistence, 'isLiveRoomDurablyRecoverable').mockImplementation(() => {
      if (room.state !== null) {
        startAttempts += 1;
        return startAttempts > 1;
      }
      return true;
    });

    const ackFail = vi.fn();
    await handlers.get('game:start')?.(roomCode, { requestId: 'a1-gs-start' }, ackFail);
    expect(ackFail).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        uncertain: true,
        error: HAND_LIFECYCLE_PERSIST_RETRY_MESSAGE,
      }),
    );
    expect(room.state).toBeNull();

    const ackOk = vi.fn();
    await handlers.get('game:start')?.(roomCode, { requestId: 'a1-gs-start' }, ackOk);
    expect(ackOk).toHaveBeenCalledWith(expect.objectContaining({ ok: true, started: true }));
    expect(room.state).not.toBeNull();
    const handAfterStart = room.state!.handNumber;
    const seqAfterStart = room.state!.sequence;

    const ackDup = vi.fn();
    await handlers.get('game:start')?.(roomCode, { requestId: 'a1-gs-start' }, ackDup);
    expect(ackDup).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, started: true, duplicate: true }),
    );
    expect(room.state!.handNumber).toBe(handAfterStart);
    expect(room.state!.sequence).toBe(seqAfterStart);
  });
});
