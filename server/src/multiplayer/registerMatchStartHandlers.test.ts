import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReservedRoom, joinRoom, resetRoomRuntimeForTests } from '../rooms';
import {
  ensureSocketDataSeat,
  initRoomSession,
  resetRoomSessionStoresForTests,
  setRoomRoster,
} from './roomSession';
import { registerMatchStartHandlers } from './registerMatchStartHandlers';

function makeSocket(socketId: string, seatId: string) {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const socket = {
    id: socketId,
    data: { playerId: seatId, userId: 'host-user' } as Record<string, unknown>,
    rooms: new Set<string>([socketId]),
    on: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return socket;
    },
    join: (roomCode: string) => {
      socket.rooms.add(roomCode);
    },
    emit: vi.fn(),
  };
  return { socket: socket as any, handlers };
}

function makeIo(roomCode: string, socketIds: string[]) {
  const members = new Set(socketIds);
  return {
    sockets: {
      sockets: new Map(socketIds.map((id) => [id, { id, rooms: new Set([id, roomCode]) }])),
      adapter: {
        rooms: new Map<string, Set<string>>([[roomCode, members]]),
      },
    },
    to: vi.fn(() => ({ emit: vi.fn() })),
  } as any;
}

describe('registerMatchStartHandlers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    initRoomSession({} as any, {
      resolveSocketIdentity: async () => ({ username: 'Host', userId: 'host-user' }),
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

  it('game:start rejects non-host players', async () => {
    const roomCode = 'STRT1';
    createReservedRoom(roomCode);
    const hostSeat = 'seat-host';
    const guestSeat = 'seat-guest';
    joinRoom(roomCode, hostSeat);
    joinRoom(roomCode, guestSeat);
    setRoomRoster(roomCode, [
      { id: hostSeat, socketId: 'sock-host', username: 'Host', userId: 'host-user' },
      { id: guestSeat, socketId: 'sock-guest', username: 'Guest', userId: 'guest-user' },
    ]);

    const io = makeIo(roomCode, ['sock-host', 'sock-guest']);
    const { socket, handlers } = makeSocket('sock-guest', guestSeat);
    ensureSocketDataSeat(socket, guestSeat);
    socket.join(roomCode);

    registerMatchStartHandlers(io, socket, {
      handlerDeps: {
        resolveSocketIdentity: async () => ({ username: 'Guest', userId: 'guest-user' }),
        normalizeUsername: (v) => String(v ?? 'Guest'),
        normalizeUserId: (v) => (typeof v === 'string' ? v : null),
        tryHydrateMatchmakingRoomShell: async () => 'skipped',
        waitUntilMatchmakingRoomSocketsReady: async () => undefined,
        onAfterMatchStarted: async () => undefined,
        notifyRoomPlayersInGame: () => undefined,
        persistRoomMatchLog: async () => undefined,
      },
    });

    const cb = vi.fn();
    await handlers.get('game:start')?.(roomCode, cb);
    expect(cb).toHaveBeenCalledWith({ ok: false, error: 'Only the room host can start the game.' });
  });

  it('player:ready on private room emits room:update without auto-starting', async () => {
    const roomCode = 'PRDY1';
    createReservedRoom(roomCode);
    const hostSeat = 'seat-host';
    joinRoom(roomCode, hostSeat);
    setRoomRoster(roomCode, [
      { id: hostSeat, socketId: 'sock-host', username: 'Host', userId: 'host-user' },
    ]);

    const io = makeIo(roomCode, ['sock-host']);
    const toEmit = vi.fn();
    io.to = vi.fn(() => ({ emit: toEmit }));
    const { socket, handlers } = makeSocket('sock-host', hostSeat);
    ensureSocketDataSeat(socket, hostSeat);
    socket.join(roomCode);

    registerMatchStartHandlers(io, socket, {
      handlerDeps: {
        resolveSocketIdentity: async () => ({ username: 'Host', userId: 'host-user' }),
        normalizeUsername: (v) => String(v ?? 'Guest'),
        normalizeUserId: (v) => (typeof v === 'string' ? v : null),
        tryHydrateMatchmakingRoomShell: async () => 'skipped',
        waitUntilMatchmakingRoomSocketsReady: async () => undefined,
        onAfterMatchStarted: async () => undefined,
        notifyRoomPlayersInGame: () => undefined,
        persistRoomMatchLog: async () => undefined,
      },
    });

    const cb = vi.fn();
    await handlers.get('player:ready')?.(roomCode, cb);
    expect(io.to).toHaveBeenCalledWith(roomCode);
    expect(toEmit).toHaveBeenCalledWith('room:update', expect.objectContaining({ players: expect.any(Array) }));
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        started: false,
      }),
    );
  });
});
