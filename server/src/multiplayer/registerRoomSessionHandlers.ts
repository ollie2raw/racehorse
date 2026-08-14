import type { Server, Socket } from 'socket.io';
import { getRoom } from '../rooms';
import {
  onActivePlayerSocketDisconnect,
} from './disconnectGrace';
import {
  broadcastStateUpdate,
  getSeatIdForSocket,
  requireRoomSessionHandlerDeps,
  reserveReconnectSeat,
} from './roomSession';
import { applyActiveMatchForfeit } from './roomForfeit';
import { registerGameplayActionHandlers } from './registerGameplayActionHandlers';
import { registerMatchStartHandlers } from './registerMatchStartHandlers';
import { registerRematchPregameHandlers } from './registerRematchPregameHandlers';
import { registerRoomAbandonHandlers } from './registerRoomAbandonHandlers';
import { registerRoomJoinHandlers } from './registerRoomJoinHandlers';
import { registerRoomLifecycleHandlers } from './registerRoomLifecycleHandlers';
import { registerRoomSpectateHandlers } from './registerRoomSpectateHandlers';
import { registerRoomUtilityHandlers } from './registerRoomUtilityHandlers';
import { registerTournamentAttachHandlers } from './registerTournamentAttachHandlers';
import { createRoomSocketAttach } from './roomSocketAttach';

export { applyActiveMatchForfeit } from './roomForfeit';

export function registerRoomSessionHandlers(io: Server, socket: Socket): void {
  const handlerDeps = requireRoomSessionHandlerDeps();
  const { leaveTrackedRoom, leaveExistingSocketRooms, attachSocketToTrackedRoom } =
    createRoomSocketAttach({ io, socket, handlerDeps });

  registerRoomJoinHandlers(io, socket, {
    handlerDeps,
    attachSocketToTrackedRoom,
  });
  registerTournamentAttachHandlers(io, socket, {
    handlerDeps,
    attachSocketToTrackedRoom,
  });
  registerRoomLifecycleHandlers(socket, {
    handlerDeps,
    leaveExistingSocketRooms,
    leaveTrackedRoom,
  });
  registerRoomAbandonHandlers(io, socket, {
    handlerDeps,
    leaveTrackedRoom,
  });
  registerGameplayActionHandlers(io, socket, {
    handlerDeps,
  });
  registerMatchStartHandlers(io, socket, {
    handlerDeps,
  });
  registerRematchPregameHandlers(io, socket, {
    handlerDeps,
  });
  registerRoomSpectateHandlers(socket, {
    handlerDeps,
    leaveExistingSocketRooms,
  });
  registerRoomUtilityHandlers(socket);
}

export function handleRoomPlayerDisconnect(
  io: Server,
  socket: Socket,
): { wasActiveRoomPlayer: boolean; roomCode?: string } {
  const roomCode = (socket.data?.roomId as string | undefined) ?? undefined;
  let wasActiveRoomPlayer = false;
  if (roomCode) {
    try {
      const room = getRoom(roomCode);
      if (room.abandonedAt) {
        wasActiveRoomPlayer = false;
      } else {
      const playerSeatId = getSeatIdForSocket(roomCode, socket.id);
      if (playerSeatId && room.players.includes(playerSeatId)) {
        wasActiveRoomPlayer = true;
        const handlerDeps = requireRoomSessionHandlerDeps();
        reserveReconnectSeat(roomCode, {
          seatId: playerSeatId,
          oldSocketId: socket.id,
          username: handlerDeps.normalizeUsername(socket.data?.username),
          userId: handlerDeps.normalizeUserId(socket.data?.userId),
        });
        onActivePlayerSocketDisconnect(roomCode, playerSeatId, io, (code) =>
          broadcastStateUpdate(code),
        );
      }
      }
    } catch {
      // room no longer exists
    }
  }

  type LeaveTrackedRoom = (roomCode: string | undefined, options?: { preserveSeat?: boolean }) => void | Promise<void>;
  const leaveTrackedRoom = (socket as Socket & { __leaveTrackedRoom?: LeaveTrackedRoom }).__leaveTrackedRoom;
  void leaveTrackedRoom?.(roomCode, { preserveSeat: wasActiveRoomPlayer });

  return { wasActiveRoomPlayer, roomCode };
}