import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRoom, resetRoomRuntimeForTests } from '../rooms';
import { initRoomSession, resetRoomSessionStoresForTests } from './roomSession';
import { registerRoomLifecycleHandlers } from './registerRoomLifecycleHandlers';

function makeSocket(socketId: string) {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const socket = {
    id: socketId,
    data: {} as Record<string, unknown>,
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

describe('registerRoomLifecycleHandlers', () => {
  beforeEach(() => {
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    initRoomSession({} as any, {
      resolveSocketIdentity: async () => ({ username: 'Host', userId: 'host-user' }),
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

  it('room:create acks with a new room code and host seat', async () => {
    const leaveExistingSocketRooms = vi.fn();
    const leaveTrackedRoom = vi.fn(async () => undefined);
    const { socket, handlers } = makeSocket('sock-host');
    registerRoomLifecycleHandlers(socket, {
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
      leaveExistingSocketRooms,
      leaveTrackedRoom,
    });

    const ack = vi.fn();
    await handlers.get('room:create')?.({}, ack);

    expect(leaveExistingSocketRooms).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        matchStarted: false,
        you: expect.any(String),
      }),
    );
    const roomCode = ack.mock.calls[0][0].roomCode as string;
    expect(getRoom(roomCode).players).toHaveLength(1);
  });

  it('room:leave rejects missing_code and delegates valid codes to leaveTrackedRoom', async () => {
    const leaveTrackedRoom = vi.fn(async () => undefined);
    const { socket, handlers } = makeSocket('sock-leave');
    registerRoomLifecycleHandlers(socket, {
      handlerDeps: {
        resolveSocketIdentity: async () => ({ username: 'Host', userId: null }),
        normalizeUsername: (v) => String(v ?? 'Guest'),
        normalizeUserId: () => null,
        tryHydrateMatchmakingRoomShell: async () => 'skipped',
        waitUntilMatchmakingRoomSocketsReady: async () => undefined,
        onAfterMatchStarted: async () => undefined,
        notifyRoomPlayersInGame: () => undefined,
        persistRoomMatchLog: async () => undefined,
      },
      leaveExistingSocketRooms: vi.fn(),
      leaveTrackedRoom,
    });

    const missingAck = vi.fn();
    await handlers.get('room:leave')?.('', missingAck);
    expect(missingAck).toHaveBeenCalledWith({ ok: false, error: 'missing_code' });
    expect(leaveTrackedRoom).not.toHaveBeenCalled();

    const okAck = vi.fn();
    await handlers.get('room:leave')?.('abc12', okAck);
    expect(leaveTrackedRoom).toHaveBeenCalledWith('ABC12');
    expect(okAck).toHaveBeenCalledWith({ ok: true, roomCode: 'ABC12' });
  });
});