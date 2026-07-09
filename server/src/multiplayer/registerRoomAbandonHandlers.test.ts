import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReservedRoom, getRoom, joinRoom, resetRoomRuntimeForTests } from '../rooms';
import { initRoomSession, setRoomRoster } from './roomSession';
import { registerRoomAbandonHandlers } from './registerRoomAbandonHandlers';

const applyActiveMatchForfeitMock = vi.fn();

vi.mock('./roomForfeit', () => ({
  applyActiveMatchForfeit: (...args: unknown[]) => applyActiveMatchForfeitMock(...args),
}));

function makeSocket(userId: string | null) {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const socket = {
    id: `sock-${userId ?? 'anon'}`,
    data: { userId } as Record<string, unknown>,
    rooms: new Set<string>(),
    on: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return socket;
    },
    emit: vi.fn(),
  };
  socket.rooms.add(socket.id);
  return { socket: socket as any, handlers };
}

function makeIo() {
  return { to: vi.fn(() => ({ emit: vi.fn() })) } as any;
}

describe('registerRoomAbandonHandlers', () => {
  beforeEach(() => {
    resetRoomRuntimeForTests();
    applyActiveMatchForfeitMock.mockReset();
    initRoomSession({} as any, {
      resolveSocketIdentity: async () => ({ username: 'Player', userId: 'u1' }),
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

  it('rejects unauthenticated abandon requests', async () => {
    const leaveTrackedRoom = vi.fn(async () => undefined);
    const { socket, handlers } = makeSocket(null);
    registerRoomAbandonHandlers(makeIo(), socket, {
      handlerDeps: {
        resolveSocketIdentity: async () => ({ username: 'Guest', userId: null }),
        normalizeUsername: (v) => String(v ?? 'Guest'),
        normalizeUserId: () => null,
        tryHydrateMatchmakingRoomShell: async () => 'skipped',
        waitUntilMatchmakingRoomSocketsReady: async () => undefined,
        onAfterMatchStarted: async () => undefined,
        notifyRoomPlayersInGame: () => undefined,
        persistRoomMatchLog: async () => undefined,
      },
      leaveTrackedRoom,
    });

    const ack = vi.fn();
    await handlers.get('room:abandon_match')?.({ roomCode: 'ROOM1' }, ack);
    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'not_authenticated' });
    expect(applyActiveMatchForfeitMock).not.toHaveBeenCalled();
    expect(leaveTrackedRoom).not.toHaveBeenCalled();
  });

  it('calls applyActiveMatchForfeit then leaveTrackedRoom on success', async () => {
    const roomCode = 'ABND1';
    createReservedRoom(roomCode);
    joinRoom(roomCode, 'p1');
    joinRoom(roomCode, 'p2');
    setRoomRoster(roomCode, [
      { id: 'p1', socketId: 'sock-u1', username: 'P1', userId: 'u1' },
      { id: 'p2', socketId: 'sock-u2', username: 'P2', userId: 'u2' },
    ]);

    applyActiveMatchForfeitMock.mockResolvedValue({ winnerUserId: 'u2' });
    const leaveTrackedRoom = vi.fn(async () => undefined);
    const io = makeIo();
    const { socket, handlers } = makeSocket('u1');
    registerRoomAbandonHandlers(io, socket, {
      handlerDeps: {
        resolveSocketIdentity: async () => ({ username: 'P1', userId: 'u1' }),
        normalizeUsername: (v) => String(v ?? 'Guest'),
        normalizeUserId: (v) => (typeof v === 'string' ? v : null),
        tryHydrateMatchmakingRoomShell: async () => 'skipped',
        waitUntilMatchmakingRoomSocketsReady: async () => undefined,
        onAfterMatchStarted: async () => undefined,
        notifyRoomPlayersInGame: () => undefined,
        persistRoomMatchLog: async () => undefined,
      },
      leaveTrackedRoom,
    });

    const ack = vi.fn();
    await handlers.get('room:abandon_match')?.({ roomCode }, ack);

    expect(applyActiveMatchForfeitMock).toHaveBeenCalledWith(
      io,
      socket,
      roomCode,
      expect.objectContaining({
        id: 'p1',
        socketId: 'sock-u1',
        username: 'P1',
        userId: 'u1',
      }),
      'manual',
    );
    expect(leaveTrackedRoom).toHaveBeenCalledWith(roomCode);
    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, roomCode, winnerId: 'u2' }),
    );
    expect(getRoom(roomCode).abandonedAt).toBeUndefined();
  });
});
