import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReservedRoom, getRoom, joinRoom, resetRoomRuntimeForTests } from '../rooms';
import { initRoomSession, setRoomRoster } from './roomSession';
import { applyActiveMatchForfeit } from './roomForfeit';

const persistRoomMatchLogMock = vi.fn(async () => undefined);

function makeIo() {
  const emit = vi.fn();
  return {
    to: vi.fn(() => ({ emit })),
    __emit: emit,
  } as any;
}

describe('applyActiveMatchForfeit', () => {
  beforeEach(() => {
    resetRoomRuntimeForTests();
    persistRoomMatchLogMock.mockClear();
    initRoomSession({} as any, {
      resolveSocketIdentity: async () => ({ username: 'Player', userId: 'u1' }),
      normalizeUsername: (value) => (typeof value === 'string' && value.trim() ? value.trim() : 'Guest'),
      normalizeUserId: (value) => (typeof value === 'string' && value.trim() ? value.trim() : null),
      tryHydrateMatchmakingRoomShell: async () => 'skipped',
      waitUntilMatchmakingRoomSocketsReady: async () => undefined,
      onAfterMatchStarted: async () => undefined,
      notifyRoomPlayersInGame: () => undefined,
      persistRoomMatchLog: persistRoomMatchLogMock,
      onGameOver: () => null,
    });
  });

  it('returns null without mutating when the room is already abandoned', async () => {
    const roomCode = 'FORF1';
    createReservedRoom(roomCode);
    joinRoom(roomCode, 'p1');
    joinRoom(roomCode, 'p2');
    setRoomRoster(roomCode, [
      { id: 'p1', socketId: 'sock-p1', username: 'P1', userId: 'u1' },
      { id: 'p2', socketId: 'sock-p2', username: 'P2', userId: 'u2' },
    ]);
    const room = getRoom(roomCode);
    room.abandonedAt = new Date().toISOString();

    const io = makeIo();
    const socket = { id: 'sock-p1', data: { userId: 'u1' } } as any;
    const result = await applyActiveMatchForfeit(io, socket, roomCode, {
      id: 'p1',
      username: 'P1',
      userId: 'u1',
    });

    expect(result).toBeNull();
    expect(persistRoomMatchLogMock).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
  });
});