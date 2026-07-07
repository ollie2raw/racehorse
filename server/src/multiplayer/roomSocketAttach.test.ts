import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReservedRoom, joinRoom, resetRoomRuntimeForTests } from '../rooms';
import {
  initRoomSession,
  resetRoomSessionStoresForTests,
  setRoomRoster,
} from './roomSession';
import { createRoomSocketAttach } from './roomSocketAttach';

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
});