/**
 * M6 — matchmaking auto-start must not fire when a seat socket never synced.
 *
 * Before: `waitUntilMatchmakingRoomSocketsReady` returned void on timeout and
 * the caller dealt anyway, so a player whose socket was not in the room was
 * force-started into a game their client never received.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../game/types';
import { createReservedRoom, joinRoom, peekRoom, resetRoomRuntimeForTests } from '../rooms';
import {
  initRoomSession,
  resetRoomSessionStoresForTests,
  setRoomRoster,
} from './roomSession';
import { createRoomSocketAttach } from './roomSocketAttach';
import * as livePersistence from './roomLivePersistence';
import * as matchTerminalJoin from './matchTerminalJoin';
import * as matchStartReady from './matchStartReady';

function makeSocket(socketId: string) {
  return {
    id: socketId,
    data: {} as Record<string, unknown>,
    rooms: new Set<string>([socketId]),
    leave: vi.fn(),
    join: vi.fn(),
    emit: vi.fn(),
  } as any;
}

function makeIo() {
  return { sockets: { sockets: new Map() }, to: vi.fn(() => ({ emit: vi.fn() })) } as any;
}

const baseDeps = {
  resolveSocketIdentity: async () => ({ username: 'Guest', userId: null }),
  normalizeUsername: (v: unknown) => String(v ?? 'Guest'),
  normalizeUserId: (v: unknown) => (typeof v === 'string' ? v : null),
  tryHydrateMatchmakingRoomShell: async () => 'skipped' as const,
  waitUntilMatchmakingRoomSocketsReady: async () => 'ready' as const,
  onAfterMatchStarted: async () => undefined,
  notifyRoomPlayersInGame: () => undefined,
  persistRoomMatchLog: async () => undefined,
};

const t = (low: number, high: number) => ({ low: Math.min(low, high), high: Math.max(low, high) });

function mkLiveGameState(): GameState {
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
    playerIds: ['p1', 'p2'],
    players: {
      p1: { id: 'p1', hand: [t(6, 5)], score: 0 },
      p2: { id: 'p2', hand: [t(4, 4)], score: 0 },
    },
    board: { left: [t(6, 6)], right: [t(6, 3)] },
    boneyard: [t(1, 0)],
    deadTiles: [t(0, 0), t(1, 1)],
    currentPlayerIndex: 0,
    handNumber: 1,
    handOpen: true,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 3,
  } as GameState;
}

/**
 * A matchmaking room with seat p1 already held by `sock-a`, so the attaching
 * socket fills the second seat and trips the auto-start path.
 */
function seedMatchmakingRoom(roomCode: string) {
  const room = createReservedRoom(roomCode, { winningScore: 60 });
  room.matchmakingMatchId = 'mm-match-sync';
  room.matchmakingParticipantUserIds = ['user-a', 'user-b'];
  joinRoom(roomCode, 'p1');
  setRoomRoster(roomCode, [
    { id: 'p1', socketId: 'sock-a', username: 'PlayerA', userId: 'user-a' },
  ]);
  return room;
}

describe('matchmaking start socket-sync gate (M6)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    initRoomSession(makeIo(), { ...baseDeps, onGameOver: () => null });
    vi.spyOn(matchTerminalJoin, 'resolveArchivedTerminalJoin').mockResolvedValue(null);
    vi.spyOn(livePersistence, 'ensureRoomHydrated').mockResolvedValue({
      kind: 'already_in_memory',
    } as any);
  });

  it('does not start the match when the sync window times out, and requeues instead', async () => {
    const roomCode = 'MMSYNC1';
    seedMatchmakingRoom(roomCode);
    const startSpy = vi.spyOn(matchStartReady, 'tryStartMatchIfReady');
    const abort = vi.fn();

    const io = makeIo();
    const socket = makeSocket('sock-b');
    const { attachSocketToTrackedRoom } = createRoomSocketAttach({
      io,
      socket,
      handlerDeps: {
        ...baseDeps,
        waitUntilMatchmakingRoomSocketsReady: async () => 'timeout' as const,
        abortMatchmakingMatchOnStartFailure: abort,
      },
    });

    await expect(
      attachSocketToTrackedRoom({
        roomCode,
        username: 'PlayerB',
        userId: 'user-b',
        via: 'room:join',
        hydrateMatchmakingRoom: true,
      }),
    ).rejects.toThrow('match_sync_failed');

    // No deal happened — nobody is live in a game their client never synced to.
    expect(startSpy).not.toHaveBeenCalled();
    expect(peekRoom(roomCode)?.state ?? null).toBeNull();
    // ...and the match attempt was handed to the M1/M2 abort + requeue path.
    expect(abort).toHaveBeenCalledWith(roomCode, 'match_sync_failed');
    // The rejected socket is not left holding a dead room.
    expect(socket.leave).toHaveBeenCalledWith(roomCode);
    expect(socket.data.roomId).toBeUndefined();
  });

  it('starts normally when both seat sockets sync in time', async () => {
    const roomCode = 'MMSYNC2';
    seedMatchmakingRoom(roomCode);
    const startSpy = vi
      .spyOn(matchStartReady, 'tryStartMatchIfReady')
      .mockResolvedValue({ started: true });
    const abort = vi.fn();

    const io = makeIo();
    const socket = makeSocket('sock-b');
    const { attachSocketToTrackedRoom } = createRoomSocketAttach({
      io,
      socket,
      handlerDeps: {
        ...baseDeps,
        waitUntilMatchmakingRoomSocketsReady: async () => 'ready' as const,
        abortMatchmakingMatchOnStartFailure: abort,
      },
    });

    const attached = await attachSocketToTrackedRoom({
      roomCode,
      username: 'PlayerB',
      userId: 'user-b',
      via: 'room:join',
      hydrateMatchmakingRoom: true,
    });

    expect(attached.room.code).toBe(roomCode);
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(abort).not.toHaveBeenCalled();
  });

  it('treats a legacy void sync result as ready (unchanged behavior for old stubs)', async () => {
    const roomCode = 'MMSYNC3';
    seedMatchmakingRoom(roomCode);
    const startSpy = vi
      .spyOn(matchStartReady, 'tryStartMatchIfReady')
      .mockResolvedValue({ started: true });
    const abort = vi.fn();

    const io = makeIo();
    const socket = makeSocket('sock-b');
    const { attachSocketToTrackedRoom } = createRoomSocketAttach({
      io,
      socket,
      handlerDeps: {
        ...baseDeps,
        waitUntilMatchmakingRoomSocketsReady: async () => undefined,
        abortMatchmakingMatchOnStartFailure: abort,
      },
    });

    await attachSocketToTrackedRoom({
      roomCode,
      username: 'PlayerB',
      userId: 'user-b',
      via: 'room:join',
      hydrateMatchmakingRoom: true,
    });

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(abort).not.toHaveBeenCalled();
  });

  it('does not double-start or strand a room when sync fails after the match already dealt', async () => {
    const roomCode = 'MMSYNC4';
    const room = seedMatchmakingRoom(roomCode);
    // The M3 lock already dealt this room from the other player's attach.
    room.state = mkLiveGameState();
    const startSpy = vi.spyOn(matchStartReady, 'tryStartMatchIfReady');
    const abort = vi.fn();

    const io = makeIo();
    const socket = makeSocket('sock-b');
    const { attachSocketToTrackedRoom } = createRoomSocketAttach({
      io,
      socket,
      handlerDeps: {
        ...baseDeps,
        waitUntilMatchmakingRoomSocketsReady: async () => 'timeout' as const,
        abortMatchmakingMatchOnStartFailure: abort,
      },
    });

    // `room.state` is set, so the auto-start block is skipped entirely: no
    // second start attempt and no abort of a live game.
    await attachSocketToTrackedRoom({
      roomCode,
      username: 'PlayerB',
      userId: 'user-b',
      via: 'room:join',
      hydrateMatchmakingRoom: true,
    });

    expect(startSpy).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
    expect(peekRoom(roomCode)?.state).toBeTruthy();
  });
});
