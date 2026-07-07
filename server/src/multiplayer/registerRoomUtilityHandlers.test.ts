import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReservedRoom, joinRoom, resetRoomRuntimeForTests } from '../rooms';
import { ensureSocketDataSeat, setRoomRoster } from './roomSession';
import { registerRoomUtilityHandlers } from './registerRoomUtilityHandlers';

function makeSocket(socketId: string) {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const toEmit = vi.fn();
  const socket = {
    id: socketId,
    data: {} as Record<string, unknown>,
    rooms: new Set<string>([socketId]),
    on: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return socket;
    },
    to: vi.fn(() => ({ emit: toEmit })),
    __toEmit: toEmit,
  };
  socket.rooms.add(socketId);
  return { socket: socket as any, handlers, toEmit };
}

describe('registerRoomUtilityHandlers', () => {
  beforeEach(() => {
    resetRoomRuntimeForTests();
  });

  it('mp:ping invokes callback with a numeric server timestamp', () => {
    const { socket, handlers } = makeSocket('sock-ping');
    registerRoomUtilityHandlers(socket);

    const cb = vi.fn();
    const before = Date.now();
    handlers.get('mp:ping')?.(undefined, cb);
    const after = Date.now();

    expect(cb).toHaveBeenCalledTimes(1);
    const serverAt = cb.mock.calls[0][0] as number;
    expect(serverAt).toBeGreaterThanOrEqual(before);
    expect(serverAt).toBeLessThanOrEqual(after);
  });

  it('player:dragging relays drag state to room peers for seated players', () => {
    const roomCode = 'DRAG1';
    createReservedRoom(roomCode);
    const seatId = 'seat-host';
    joinRoom(roomCode, seatId);
    setRoomRoster(roomCode, [
      { id: seatId, socketId: 'sock-host', username: 'Host', userId: 'u1' },
    ]);

    const { socket, handlers, toEmit } = makeSocket('sock-host');
    ensureSocketDataSeat(socket, seatId);
    socket.rooms.add(roomCode);
    registerRoomUtilityHandlers(socket);

    handlers.get('player:dragging')?.(roomCode, { dragging: true });

    expect(socket.to).toHaveBeenCalledWith(roomCode);
    expect(toEmit).toHaveBeenCalledWith('player:dragging', {
      playerId: seatId,
      dragging: true,
    });
  });

  it('player:dragging ignores invalid room codes and non-players', () => {
    const { socket, handlers, toEmit } = makeSocket('sock-spectator');
    registerRoomUtilityHandlers(socket);

    handlers.get('player:dragging')?.('', { dragging: true });
    handlers.get('player:dragging')?.('NOPE', { dragging: true });

    expect(toEmit).not.toHaveBeenCalled();
  });
});