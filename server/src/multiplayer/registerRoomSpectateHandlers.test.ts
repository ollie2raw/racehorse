import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReservedRoom, getRoom, joinRoom, resetRoomRuntimeForTests } from '../rooms';
import { initRoomSession, setRoomRoster } from './roomSession';
import { registerRoomSpectateHandlers } from './registerRoomSpectateHandlers';

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

  it('acks successful spectate with roster snapshot and socket room membership', async () => {
    const roomCode = 'SPEOK1';
    createReservedRoom(roomCode);
    joinRoom(roomCode, 'p1');
    setRoomRoster(roomCode, [
      { id: 'p1', socketId: 'sock-p1', username: 'P1', userId: 'u1' },
    ]);

    const leaveExistingSocketRooms = vi.fn();
    const { socket, handlers } = makeSocket('spec-2');
    registerRoomSpectateHandlers(socket, {
      handlerDeps: {
        resolveSocketIdentity: async () => ({ username: 'Spec', userId: 'spec-2' }),
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
});