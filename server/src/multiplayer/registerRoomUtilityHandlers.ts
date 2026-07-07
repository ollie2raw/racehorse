import type { Socket } from 'socket.io';
import { getRoom } from '../rooms';
import { resolveActorSeatId } from './roomSession';

export function registerRoomUtilityHandlers(socket: Socket): void {
  socket.on('mp:ping', (_sentAt: unknown, cb?: (serverAt: number) => void) => {
    if (typeof cb === 'function') cb(Date.now());
  });

  socket.on('player:dragging', (code: unknown, payload?: { dragging?: boolean }) => {
    const roomCode = String(code ?? '').trim().toUpperCase();
    if (!roomCode) return;
    try {
      const room = getRoom(roomCode);
      const playerSeatId = resolveActorSeatId(roomCode, socket);
      if (!room.players.includes(playerSeatId)) return;
      socket.to(roomCode).emit('player:dragging', {
        playerId: playerSeatId,
        dragging: Boolean(payload?.dragging),
      });
    } catch {
      // ignore invalid room
    }
  });
}