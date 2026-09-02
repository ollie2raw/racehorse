/**
 * S2 — room:spectate must not forfeit a live seat the socket holds elsewhere.
 * P4 — leaveExistingSocketRooms must be awaited before the new attach proceeds.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../game/types';
import {
  createReservedRoom,
  getRoom,
  joinRoom,
  peekRoom,
  resetRoomRuntimeForTests,
} from '../rooms';
import {
  getRoomRoster,
  initRoomSession,
  resetRoomSessionStoresForTests,
  setRoomRoster,
} from './roomSession';
import { createRoomSocketAttach } from './roomSocketAttach';
import { registerRoomSpectateHandlers } from './registerRoomSpectateHandlers';
import { withRoomGameplayLock, resetRoomGameplayLocksForTests } from './roomGameplayLock';
import * as livePersistence from './roomLivePersistence';
import * as matchTerminalJoin from './matchTerminalJoin';
import * as roomForfeit from './roomForfeit';

vi.mock('./roomForfeit', async (importOriginal) => {
  const actual = await importOriginal<typeof roomForfeit>();
  return { ...actual, applyActiveMatchForfeit: vi.fn() };
});

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
    board: {
      mainLine: [{ tile: t(1, 4), orientation: 'horizontal-normal' as const }],
      leftEnd: 1,
      rightEnd: 4,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    },
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

function makeSocket(socketId: string) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const socket: any = {
    id: socketId,
    data: {} as Record<string, unknown>,
    rooms: new Set<string>([socketId]),
    connected: true,
    on: (event: string, handler: (...args: any[]) => any) => {
      handlers.set(event, handler);
      return socket;
    },
    join: vi.fn((roomCode: string) => {
      socket.rooms.add(roomCode);
    }),
    leave: vi.fn((roomCode: string) => {
      socket.rooms.delete(roomCode);
    }),
    emit: vi.fn(),
  };
  return { socket, handlers };
}

function makeIo() {
  return { sockets: { sockets: new Map() }, to: vi.fn(() => ({ emit: vi.fn() })) } as any;
}

const handlerDeps: any = {
  resolveSocketIdentity: async () => ({ username: 'PlayerA', userId: 'user-a' }),
  normalizeUsername: (v: unknown) => String(v ?? 'Guest'),
  normalizeUserId: (v: unknown) => (typeof v === 'string' ? v : null),
  tryHydrateMatchmakingRoomShell: async () => 'skipped' as const,
  waitUntilMatchmakingRoomSocketsReady: async () => 'ready' as const,
  onAfterMatchStarted: async () => undefined,
  notifyRoomPlayersInGame: () => undefined,
  persistRoomMatchLog: async () => undefined,
};

/** Room A: this socket is seated at p1 in a running match. */
function seedLiveSeatedRoom(roomCode: string, socketId: string) {
  const room = createReservedRoom(roomCode, { winningScore: 60 });
  joinRoom(roomCode, 'p1');
  joinRoom(roomCode, 'p2');
  setRoomRoster(roomCode, [
    { id: 'p1', socketId, username: 'PlayerA', userId: 'user-a' },
    { id: 'p2', socketId: 'sock-other', username: 'PlayerB', userId: 'user-b' },
  ]);
  room.state = mkLiveGameState();
  return room;
}

/** Room B: an unrelated room to spectate / join. `spectatable` so the MP-G3
 * room-kind gate lets a spectator in — these tests are about seat preservation,
 * not the gate itself. */
function seedOtherRoom(roomCode: string) {
  const room = createReservedRoom(roomCode, { winningScore: 60 });
  room.config.spectatable = true;
  joinRoom(roomCode, 'q1');
  setRoomRoster(roomCode, [
    { id: 'q1', socketId: 'sock-q1', username: 'Host', userId: 'user-host' },
  ]);
  return room;
}

describe('spectate seat preservation (S2) and awaited room detach (P4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    resetRoomGameplayLocksForTests();
    initRoomSession(makeIo(), { ...handlerDeps, onGameOver: () => null });
    vi.spyOn(matchTerminalJoin, 'resolveArchivedTerminalJoin').mockResolvedValue(null);
    vi.spyOn(livePersistence, 'ensureRoomHydrated').mockResolvedValue({
      kind: 'already_in_memory',
    } as any);
    // Stand-in for the real forfeit: latches abandonedAt like the real one does.
    vi.mocked(roomForfeit.applyActiveMatchForfeit).mockImplementation((async (
      _io: unknown,
      _socket: unknown,
      code: string,
    ) => {
      const room = peekRoom(code);
      if (room) room.abandonedAt = new Date().toISOString();
      return { winnerUserId: null };
    }) as any);
  });

  it('S2: spectating another room does not forfeit the live match this socket is playing', async () => {
    const { socket, handlers } = makeSocket('sock-a');
    seedLiveSeatedRoom('LIVEA1', socket.id);
    seedOtherRoom('SPECB1');
    socket.rooms.add('LIVEA1');
    socket.data.roomId = 'LIVEA1';
    socket.data.playerId = 'p1';

    const { leaveExistingSocketRooms } = createRoomSocketAttach({
      io: makeIo(),
      socket,
      handlerDeps,
    });
    registerRoomSpectateHandlers(socket, { handlerDeps, leaveExistingSocketRooms });

    const ack = vi.fn();
    await handlers.get('room:spectate')?.('SPECB1', {}, ack);

    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true, roomCode: 'SPECB1' }));
    // The live match is untouched: no forfeit, no abandon, seat and roster intact.
    expect(roomForfeit.applyActiveMatchForfeit).not.toHaveBeenCalled();
    const live = getRoom('LIVEA1');
    expect(live.abandonedAt).toBeUndefined();
    expect(live.players).toContain('p1');
    expect(getRoomRoster('LIVEA1').find((p) => p.id === 'p1')?.socketId).toBe('sock-a');
    // ...but the socket is detached from the old room's broadcasts and is in B.
    expect(socket.rooms.has('SPECB1')).toBe(true);
  });

  it('S2: spectating still cleans up a non-live seat (lobby room is not preserved)', async () => {
    const { socket, handlers } = makeSocket('sock-a');
    const lobby = createReservedRoom('LOBBY1', { winningScore: 60 });
    joinRoom('LOBBY1', 'p1');
    setRoomRoster('LOBBY1', [
      { id: 'p1', socketId: socket.id, username: 'PlayerA', userId: 'user-a' },
    ]);
    expect(lobby.state).toBeNull();
    seedOtherRoom('SPECB2');
    socket.rooms.add('LOBBY1');
    socket.data.roomId = 'LOBBY1';

    const { leaveExistingSocketRooms } = createRoomSocketAttach({
      io: makeIo(),
      socket,
      handlerDeps,
    });
    registerRoomSpectateHandlers(socket, { handlerDeps, leaveExistingSocketRooms });

    await handlers.get('room:spectate')?.('SPECB2', {}, vi.fn());

    // Nothing live to protect, so the seat is released exactly as before.
    expect(peekRoom('LOBBY1')?.players ?? []).not.toContain('p1');
    expect(roomForfeit.applyActiveMatchForfeit).not.toHaveBeenCalled();
  });

  it('S2: an intentional room:leave on a live room still forfeits', async () => {
    const { socket } = makeSocket('sock-a');
    seedLiveSeatedRoom('LIVEA2', socket.id);
    socket.rooms.add('LIVEA2');
    socket.data.roomId = 'LIVEA2';
    socket.data.playerId = 'p1';

    const { leaveTrackedRoom } = createRoomSocketAttach({
      io: makeIo(),
      socket,
      handlerDeps,
    });

    // This is exactly what the room:leave handler calls.
    await leaveTrackedRoom('LIVEA2');

    expect(roomForfeit.applyActiveMatchForfeit).toHaveBeenCalledTimes(1);
    expect(getRoom('LIVEA2').abandonedAt).toBeTruthy();
    expect(getRoom('LIVEA2').players).not.toContain('p1');
  });

  it('P4: the old room forfeit completes before the new attach resolves', async () => {
    const order: string[] = [];
    vi.mocked(roomForfeit.applyActiveMatchForfeit).mockImplementation((async (
      _io: unknown,
      _socket: unknown,
      code: string,
    ) => {
      // Force the forfeit across several macrotasks: fire-and-forget would let
      // the attach ack land first.
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      const room = peekRoom(code);
      if (room) room.abandonedAt = new Date().toISOString();
      order.push('forfeit');
      return { winnerUserId: null };
    }) as any);

    const { socket } = makeSocket('sock-a');
    seedLiveSeatedRoom('LIVEA3', socket.id);
    seedOtherRoom('JOINB3');
    socket.rooms.add('LIVEA3');
    socket.data.roomId = 'LIVEA3';
    socket.data.playerId = 'p1';

    const { attachSocketToTrackedRoom } = createRoomSocketAttach({
      io: makeIo(),
      socket,
      handlerDeps,
    });

    await attachSocketToTrackedRoom({
      roomCode: 'JOINB3',
      username: 'PlayerA',
      userId: 'user-a',
      via: 'room:join',
      hydrateMatchmakingRoom: false,
    });
    order.push('attach');

    expect(order).toEqual(['forfeit', 'attach']);
    expect(getRoom('LIVEA3').abandonedAt).toBeTruthy();
  });

  it('P4: awaiting the detach does not deadlock when leaving and re-attaching the same room', async () => {
    const { socket } = makeSocket('sock-a');
    seedLiveSeatedRoom('LIVEA4', socket.id);
    socket.rooms.add('LIVEA4');
    socket.data.roomId = 'LIVEA4';
    socket.data.playerId = 'p1';

    const { attachSocketToTrackedRoom } = createRoomSocketAttach({
      io: makeIo(),
      socket,
      handlerDeps,
    });

    // Leave (forfeit) and re-attach target the same room code — the worst case
    // for lock contention. The forfeit path takes no gameplay lock and the
    // detach is fully awaited before the attach begins, so nothing nests.
    await expect(
      attachSocketToTrackedRoom({
        roomCode: 'LIVEA4',
        username: 'PlayerA',
        userId: 'user-a',
        via: 'room:join',
        hydrateMatchmakingRoom: false,
      }),
    ).resolves.toBeTruthy();

    // The room's gameplay lock is free afterwards — no chain left held.
    await expect(withRoomGameplayLock('LIVEA4', async () => 'free')).resolves.toBe('free');

    // And the rejoin did not forfeit the match it was rejoining.
    expect(roomForfeit.applyActiveMatchForfeit).not.toHaveBeenCalled();
    expect(getRoom('LIVEA4').abandonedAt).toBeUndefined();
    expect(getRoom('LIVEA4').players).toContain('p1');
  });
});
