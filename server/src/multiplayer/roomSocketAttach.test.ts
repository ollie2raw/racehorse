import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReservedRoom, joinRoom, resetRoomRuntimeForTests } from '../rooms';
import {
  initRoomSession,
  resetRoomSessionStoresForTests,
  setRoomRoster,
  getSeatIdForSocket,
  resolveActorSeatId,
} from './roomSession';
import { createRoomSocketAttach } from './roomSocketAttach';
import * as livePersistence from './roomLivePersistence';

function makeSocket(socketId: string) {
  const socket = {
    id: socketId,
    data: {} as Record<string, unknown>,
    rooms: new Set<string>([socketId]),
    leave: vi.fn(),
    join: vi.fn(),
    emit: vi.fn(),
  };
  return socket as any;
}

const handlerDeps = {
  resolveSocketIdentity: async () => ({ username: 'Guest', userId: null }),
  normalizeUsername: (v: unknown) => String(v ?? 'Guest'),
  normalizeUserId: (v: unknown) => (typeof v === 'string' ? v : null),
  tryHydrateMatchmakingRoomShell: async () => 'skipped' as const,
  waitUntilMatchmakingRoomSocketsReady: async () => undefined,
  onAfterMatchStarted: async () => undefined,
  notifyRoomPlayersInGame: () => undefined,
  persistRoomMatchLog: async () => undefined,
};

describe('createRoomSocketAttach', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    initRoomSession({ sockets: { sockets: new Map() }, to: vi.fn(() => ({ emit: vi.fn() })) } as any, {
      ...handlerDeps,
      onGameOver: () => null,
    });
  });

  it('stashes leaveTrackedRoom on socket.__leaveTrackedRoom', async () => {
    const io = { sockets: { sockets: new Map() }, to: vi.fn(() => ({ emit: vi.fn() })) } as any;
    const socket = makeSocket('sock-1');
    const { leaveTrackedRoom } = createRoomSocketAttach({ io, socket, handlerDeps });
    expect((socket as any).__leaveTrackedRoom).toBe(leaveTrackedRoom);
  });

  it('leaveExistingSocketRooms clears socket.data.roomId after leaving prior rooms', async () => {
    const roomCode = 'ATT01';
    createReservedRoom(roomCode);
    joinRoom(roomCode, 'p1');
    setRoomRoster(roomCode, [{ id: 'p1', socketId: 'sock-1', username: 'P1', userId: 'u1' }]);

    const io = { sockets: { sockets: new Map() }, to: vi.fn(() => ({ emit: vi.fn() })) } as any;
    const socket = makeSocket('sock-1');
    socket.rooms.add(roomCode);
    socket.data.roomId = roomCode;
    socket.data.playerId = 'p1';

    const { leaveExistingSocketRooms } = createRoomSocketAttach({ io, socket, handlerDeps });
    leaveExistingSocketRooms();
    expect(socket.data.roomId).toBeUndefined();
  });

  it('surfaces persistence_unavailable distinctly during attach', async () => {
    const io = { sockets: { sockets: new Map() }, to: vi.fn(() => ({ emit: vi.fn() })) } as any;
    const socket = makeSocket('sock-2');
    vi.spyOn(livePersistence, 'ensureRoomHydrated').mockResolvedValue({
      kind: 'persistence_unavailable',
      error: 'timeout',
    });

    const { attachSocketToTrackedRoom } = createRoomSocketAttach({ io, socket, handlerDeps });

    await expect(
      attachSocketToTrackedRoom({
        roomCode: 'MMTIME',
        username: 'Guest',
        userId: null,
        via: 'room:join',
        hydrateMatchmakingRoom: true,
      }),
    ).rejects.toThrow('room_persistence_unavailable');
  });

  it('treats snapshot_freshness_unknown as an explicit recovery failure', async () => {
    const io = { sockets: { sockets: new Map() }, to: vi.fn(() => ({ emit: vi.fn() })) } as any;
    const socket = makeSocket('sock-2f');
    vi.spyOn(livePersistence, 'ensureRoomHydrated').mockResolvedValue({
      kind: 'snapshot_freshness_unknown',
      error: 'snapshot_missing_commit_fence',
    });

    const { attachSocketToTrackedRoom } = createRoomSocketAttach({ io, socket, handlerDeps });

    await expect(
      attachSocketToTrackedRoom({
        roomCode: 'MMUNK',
        username: 'Guest',
        userId: null,
        via: 'room:join',
        hydrateMatchmakingRoom: true,
      }),
    ).rejects.toThrow('room_snapshot_uncommitted');
  });

  it('does not treat shell_only hydration as active gameplay state without a matchmaking shell', async () => {
    const io = { sockets: { sockets: new Map() }, to: vi.fn(() => ({ emit: vi.fn() })) } as any;
    const socket = makeSocket('sock-3');
    vi.spyOn(livePersistence, 'ensureRoomHydrated').mockResolvedValue({
      kind: 'shell_only',
    });

    const { attachSocketToTrackedRoom } = createRoomSocketAttach({
      io,
      socket,
      handlerDeps: {
        ...handlerDeps,
        tryHydrateMatchmakingRoomShell: async () => ({ kind: 'not_found' }),
      },
    });

    await expect(
      attachSocketToTrackedRoom({
        roomCode: 'MMSHELL',
        username: 'Guest',
        userId: null,
        via: 'room:join',
        hydrateMatchmakingRoom: true,
      }),
    ).rejects.toThrow('room_shell_only');
  });

  it('allows degraded reconnect only when room authority is already in memory', async () => {
    const roomCode = 'DEGR1';
    createReservedRoom(roomCode);
    joinRoom(roomCode, 'p1');
    const room = joinRoom(roomCode, 'p2');
    room.durability.status = 'degraded';
    setRoomRoster(roomCode, [
      { id: 'p1', socketId: 'sock-old', username: 'P1', userId: 'u1' },
      { id: 'p2', socketId: 'sock-p2', username: 'P2', userId: 'u2' },
    ]);

    const io = {
      sockets: {
        sockets: new Map([
          ['sock-old', { id: 'sock-old', connected: false }],
        ]),
      },
      to: vi.fn(() => ({ emit: vi.fn() })),
    } as any;
    const socket = makeSocket('sock-new');
    const { attachSocketToTrackedRoom } = createRoomSocketAttach({
      io,
      socket,
      handlerDeps: {
        ...handlerDeps,
        resolveSocketIdentity: async () => ({ username: 'P1', userId: 'u1' }),
      },
    });

    await expect(
      attachSocketToTrackedRoom({
        roomCode,
        username: 'P1',
        userId: 'u1',
        via: 'room:join',
        hydrateMatchmakingRoom: true,
      }),
    ).resolves.toMatchObject({
      room: expect.objectContaining({ code: roomCode }),
      joinedPlayerSeatId: 'p1',
    });
  });

  it('blocks degraded fresh joins', async () => {
    const roomCode = 'DEGR2';
    createReservedRoom(roomCode);
    const room = joinRoom(roomCode, 'p1');
    room.durability.status = 'degraded';
    setRoomRoster(roomCode, [{ id: 'p1', socketId: 'sock-host', username: 'Host', userId: 'u1' }]);

    const io = { sockets: { sockets: new Map() }, to: vi.fn(() => ({ emit: vi.fn() })) } as any;
    const socket = makeSocket('sock-guest');
    const { attachSocketToTrackedRoom } = createRoomSocketAttach({ io, socket, handlerDeps });

    await expect(
      attachSocketToTrackedRoom({
        roomCode,
        username: 'Guest',
        userId: 'u2',
        via: 'room:join',
        hydrateMatchmakingRoom: true,
      }),
    ).rejects.toThrow('room_degraded');
  });

  it('blocks failed reconnects even when the room is still in memory', async () => {
    const roomCode = 'FAIL1';
    createReservedRoom(roomCode);
    joinRoom(roomCode, 'p1');
    const room = joinRoom(roomCode, 'p2');
    room.durability.status = 'failed';
    setRoomRoster(roomCode, [
      { id: 'p1', socketId: 'sock-old', username: 'P1', userId: 'u1' },
      { id: 'p2', socketId: 'sock-p2', username: 'P2', userId: 'u2' },
    ]);

    const io = {
      sockets: {
        sockets: new Map([
          ['sock-old', { id: 'sock-old', connected: false }],
        ]),
      },
      to: vi.fn(() => ({ emit: vi.fn() })),
    } as any;
    const socket = makeSocket('sock-new');
    const { attachSocketToTrackedRoom } = createRoomSocketAttach({
      io,
      socket,
      handlerDeps: {
        ...handlerDeps,
        resolveSocketIdentity: async () => ({ username: 'P1', userId: 'u1' }),
      },
    });

    await expect(
      attachSocketToTrackedRoom({
        roomCode,
        username: 'P1',
        userId: 'u1',
        via: 'room:join',
        hydrateMatchmakingRoom: true,
      }),
    ).rejects.toThrow('reconnect_unavailable');
  });

  it('gives the new socket sole authority over a claimed seat and rejects the superseded old socket', async () => {
    const roomCode = 'DUPTAB';
    createReservedRoom(roomCode);
    joinRoom(roomCode, 'p1');

    const oldSocket = makeSocket('sock-old');
    oldSocket.connected = true;
    oldSocket.data.roomId = roomCode;
    oldSocket.data.playerId = 'p1';
    oldSocket.disconnect = vi.fn();

    setRoomRoster(roomCode, [
      { id: 'p1', socketId: 'sock-old', username: 'P1', userId: 'u1' },
    ]);

    const io = {
      sockets: { sockets: new Map([['sock-old', oldSocket]]) },
      to: vi.fn(() => ({ emit: vi.fn() })),
    } as any;

    const newSocket = makeSocket('sock-new');
    const { attachSocketToTrackedRoom } = createRoomSocketAttach({
      io,
      socket: newSocket,
      handlerDeps: {
        ...handlerDeps,
        resolveSocketIdentity: async () => ({ username: 'P1', userId: 'u1' }),
      },
    });

    const result = await attachSocketToTrackedRoom({
      roomCode,
      username: 'P1',
      userId: 'u1',
      via: 'room:join',
      hydrateMatchmakingRoom: true,
    });

    expect(result.joinedPlayerSeatId).toBe('p1');

    // New socket is authoritative for the seat.
    expect(getSeatIdForSocket(roomCode, 'sock-new')).toBe('p1');
    expect(resolveActorSeatId(roomCode, newSocket)).toBe('p1');

    // Old socket was told it was superseded, removed from the room channel,
    // and force-disconnected — leaving it connected indefinitely would leak
    // a live socket.io connection for as long as the stale tab stays open
    // (ping/pong keepalive only reaps genuinely dead connections, not a
    // merely-superseded-but-responsive one). Correctness does not depend on
    // this disconnect: seat invalidation + leave() happen first, so
    // resolveActorSeatId already rejects this socket even in the brief
    // window before the transport actually tears down.
    expect(oldSocket.emit).toHaveBeenCalledWith(
      'room:session:superseded',
      expect.objectContaining({ newSocketId: 'sock-new' }),
    );
    expect(oldSocket.leave).toHaveBeenCalledWith(roomCode);
    expect(oldSocket.disconnect).toHaveBeenCalledWith(true);

    // Old socket can no longer resolve or act as the seat's authority, even
    // via its stale cached socket.data.playerId (the duplicate-tab race this
    // guards against: an in-flight action from the old tab after supersession).
    expect(getSeatIdForSocket(roomCode, 'sock-old')).not.toBe('p1');
    expect(() => resolveActorSeatId(roomCode, oldSocket)).toThrow(
      'Player seat not found for socket.',
    );
  });
});
