import { describe, expect, it } from 'vitest';
import type { Socket } from 'socket.io';
import { resolveActorSeatId, setRoomRoster, deleteRoomRoster } from './roomSession';

function makeSocket(id: string, cachedPlayerId?: string): Socket {
  return { id, data: cachedPlayerId ? { playerId: cachedPlayerId } : {} } as unknown as Socket;
}

describe('resolveActorSeatId — stale-socket rejection', () => {
  const roomCode = 'RESOLVE1';

  it('resolves the seat for the socket that currently owns it', () => {
    setRoomRoster(roomCode, [
      { id: 'seat-1', socketId: 'sock-new', username: 'A', userId: 'u1' },
      { id: 'seat-2', socketId: 'sock-2', username: 'B', userId: 'u2' },
    ]);
    const currentSocket = makeSocket('sock-new', 'seat-1');
    expect(resolveActorSeatId(roomCode, currentSocket)).toBe('seat-1');
    deleteRoomRoster(roomCode);
  });

  it('does NOT resolve a seat for a socket holding a stale cached playerId after that seat has been migrated to a new socket', () => {
    // seat-1 has been migrated to sock-new (a second tab taking over), but
    // the stale socket (sock-old) still carries socket.data.playerId =
    // 'seat-1' from before migration — exactly the race-window condition:
    // migration has updated the roster, but this specific stale socket's
    // own cached data hasn't been invalidated yet (or never was, in the
    // race window between roster update and old-socket teardown).
    setRoomRoster(roomCode, [
      { id: 'seat-1', socketId: 'sock-new', username: 'A', userId: 'u1' },
      { id: 'seat-2', socketId: 'sock-2', username: 'B', userId: 'u2' },
    ]);
    const staleSocket = makeSocket('sock-old', 'seat-1');

    expect(() => resolveActorSeatId(roomCode, staleSocket)).toThrow(
      'Player seat not found for socket.',
    );
    deleteRoomRoster(roomCode);
  });
});
