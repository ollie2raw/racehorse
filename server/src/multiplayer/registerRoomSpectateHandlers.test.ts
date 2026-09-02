import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReservedRoom, getRoom, joinRoom, resetRoomRuntimeForTests } from '../rooms';
import { initRoomSession, setRoomRoster } from './roomSession';
import { registerRoomSpectateHandlers } from './registerRoomSpectateHandlers';
import { failedRoomLookupLimiter } from '../rateLimit';

function makeSocket(userId: string | null) {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const socket = {
    id: `sock-${userId ?? 'anon'}`,
    data: {} as Record<string, unknown>,
    rooms: new Set<string>(),
    connected: true,
    on: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return socket;
    },
    join: (roomCode: string) => {
      socket.rooms.add(roomCode);
    },
    emit: vi.fn(),
  };
  socket.rooms.add(socket.id);
  return { socket: socket as any, handlers };
}

describe('registerRoomSpectateHandlers', () => {
  beforeEach(() => {
    resetRoomRuntimeForTests();
    initRoomSession({} as any, {
      resolveSocketIdentity: async (config) => ({
        username: typeof config.username === 'string' ? config.username : 'Spectator',
        userId: typeof config.userId === 'string' ? config.userId : null,
      }),
      normalizeUsername: (value) => (typeof value === 'string' && value.trim() ? value.trim() : 'Guest'),
      normalizeUserId: (value) => (typeof value === 'string' && value.trim() ? value.trim() : null),
      tryHydrateMatchmakingRoomShell: async () => 'skipped',
      waitUntilMatchmakingRoomSocketsReady: async () => undefined,
      onAfterMatchStarted: async () => undefined,
      notifyRoomPlayersInGame: () => undefined,
      persistRoomMatchLog: async () => undefined,
      onGameOver: () => null,
    });
  });

  it('rejects spectate on abandoned rooms', async () => {
    const roomCode = 'SPECAB';
    createReservedRoom(roomCode);
    joinRoom(roomCode, 'p1');
    const room = getRoom(roomCode);
    room.abandonedAt = new Date().toISOString();

    const leaveExistingSocketRooms = vi.fn();
    const { socket, handlers } = makeSocket('spec-1');
    registerRoomSpectateHandlers(socket, {
      handlerDeps: {
        resolveSocketIdentity: async () => ({ username: 'Spec', userId: 'spec-1' }),
        normalizeUsername: (v) => String(v ?? 'Guest'),
        normalizeUserId: (v) => (typeof v === 'string' ? v : null),
        tryHydrateMatchmakingRoomShell: async () => 'skipped',
        waitUntilMatchmakingRoomSocketsReady: async () => undefined,
        onAfterMatchStarted: async () => undefined,
        notifyRoomPlayersInGame: () => undefined,
        persistRoomMatchLog: async () => undefined,
      },
      leaveExistingSocketRooms,
    });

    const ack = vi.fn();
    await handlers.get('room:spectate')?.(roomCode, {}, ack);

    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'match_abandoned' });
    expect(leaveExistingSocketRooms).toHaveBeenCalledTimes(1);
  });

  const deps = (userId: string | null) => ({
    resolveSocketIdentity: async () => ({ username: 'Spec', userId }),
    normalizeUsername: (v: unknown) => String(v ?? 'Guest'),
    normalizeUserId: (v: unknown) => (typeof v === 'string' ? v : null),
    tryHydrateMatchmakingRoomShell: async () => 'skipped' as const,
    waitUntilMatchmakingRoomSocketsReady: async () => undefined,
    onAfterMatchStarted: async () => undefined,
    notifyRoomPlayersInGame: () => undefined,
    persistRoomMatchLog: async () => undefined,
  });

  function wire(userId: string | null) {
    const leaveExistingSocketRooms = vi.fn();
    const { socket, handlers } = makeSocket(userId ?? 'anon');
    registerRoomSpectateHandlers(socket, {
      handlerDeps: deps(userId) as any,
      leaveExistingSocketRooms,
    });
    return { socket, handlers, leaveExistingSocketRooms };
  }

  it('acks successful spectate on a matchmaking room with roster snapshot and socket room membership', async () => {
    const roomCode = 'SPEOK1';
    createReservedRoom(roomCode);
    getRoom(roomCode).matchmakingMatchId = 'mm-1';
    joinRoom(roomCode, 'p1');
    setRoomRoster(roomCode, [
      { id: 'p1', socketId: 'sock-p1', username: 'P1', userId: 'u1' },
    ]);

    const { socket, handlers } = wire('spec-2');
    const ack = vi.fn();
    await handlers.get('room:spectate')?.(roomCode, {}, ack);

    expect(socket.rooms.has(roomCode)).toBe(true);
    expect(socket.data.roomId).toBe(roomCode);
    expect(socket.data.playerId).toBe(socket.id);
    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        roomCode,
        matchStarted: false,
        players: [{ id: 'p1', socketId: 'sock-p1', username: 'P1', userId: 'u1' }],
      }),
    );
  });

  it('MP-G3: rejects an unauthenticated spectator with auth_required', async () => {
    const roomCode = 'SPECAUTH';
    createReservedRoom(roomCode);
    getRoom(roomCode).matchmakingMatchId = 'mm-2';
    joinRoom(roomCode, 'p1');

    const { socket, handlers } = wire(null);
    const ack = vi.fn();
    await handlers.get('room:spectate')?.(roomCode, {}, ack);

    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'auth_required' });
    expect(socket.rooms.has(roomCode)).toBe(false);
  });

  it('MP-G3: blocks spectating a private room outright with not_spectatable', async () => {
    const roomCode = 'SPECPRIV';
    createReservedRoom(roomCode); // private — no matchmaking/tournament markers
    joinRoom(roomCode, 'p1');

    const incSpy = vi.spyOn(failedRoomLookupLimiter, 'increment');
    const { socket, handlers } = wire('spec-3');
    const ack = vi.fn();
    await handlers.get('room:spectate')?.(roomCode, {}, ack);

    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'not_spectatable' });
    expect(socket.rooms.has(roomCode)).toBe(false);
    // the room exists — a rejected spectate must NOT feed brute-force detection
    expect(incSpy).not.toHaveBeenCalled();
    incSpy.mockRestore();
  });

  it('MP-G3: allows a private room that opted in via config.spectatable', async () => {
    const roomCode = 'SPECOPTIN';
    createReservedRoom(roomCode);
    getRoom(roomCode).config.spectatable = true;
    joinRoom(roomCode, 'p1');
    setRoomRoster(roomCode, [{ id: 'p1', socketId: 'sock-p1', username: 'P1', userId: 'u1' }]);

    const { socket, handlers } = wire('spec-4');
    const ack = vi.fn();
    await handlers.get('room:spectate')?.(roomCode, {}, ack);

    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true, roomCode }));
    expect(socket.rooms.has(roomCode)).toBe(true);
  });
});