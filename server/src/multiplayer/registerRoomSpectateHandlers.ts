import type { Socket } from 'socket.io';
import { appendRoomEvent } from '../roomEvents';
import { getRoom, getRoomMatchEventMeta, type Room } from '../rooms';
import {
  clearSocketRematchReady,
  getHandCounts,
  getRoomRoster,
  maskStateForRecipient,
  type AckFn,
  type RoomJoinConfig,
  type RoomSessionHandlerDeps,
} from './roomSession';

export type RegisterRoomSpectateHandlersParams = {
  handlerDeps: RoomSessionHandlerDeps;
  leaveExistingSocketRooms: () => void;
};

export function registerRoomSpectateHandlers(
  socket: Socket,
  params: RegisterRoomSpectateHandlersParams,
): void {
  const { handlerDeps, leaveExistingSocketRooms } = params;

  socket.on('room:spectate', async (argCode: unknown, arg2?: unknown, arg3?: unknown) => {
    const cb = (
      typeof arg3 === 'function' ? arg3 : typeof arg2 === 'function' ? arg2 : undefined
    ) as AckFn | undefined;
    const config =
      arg2 && typeof arg2 === 'object' && !Array.isArray(arg2) ? (arg2 as RoomJoinConfig) : {};
    const code = String(argCode ?? '').trim().toUpperCase();
    try {
      const { username, userId } = await handlerDeps.resolveSocketIdentity(config);
      if (!code) return cb?.({ ok: false, error: 'missing_code' });
      clearSocketRematchReady((socket.data?.roomId as string | undefined) ?? undefined, socket.id);
      leaveExistingSocketRooms();

      let room: Room | null = null;
      try {
        room = getRoom(code);
      } catch {
        return cb?.({ ok: false, error: 'not_found' });
      }
      if (room.abandonedAt) {
        return cb?.({ ok: false, error: 'match_abandoned' });
      }

      // Socket room only — DO NOT join the game engine.
      socket.join(code);
      socket.data.roomId = code;
      socket.data.username = username;
      socket.data.userId = userId;
      socket.data.playerId = socket.id;

      // Send roster snapshot
      const roster = getRoomRoster(code);
      socket.emit('room:update', { players: roster });

      // Send a spectator-safe snapshot to just this socket.
      if (room.state) {
        const specMasked = maskStateForRecipient(room.state, null);
        socket.emit('state:update', {
          state: { ...specMasked, handCounts: getHandCounts(room.state) },
          legalMoves: [],
          canDraw: false,
          eventMeta: getRoomMatchEventMeta(code),
          matchStarted: true,
        });
      }

      appendRoomEvent(room, {
        type: 'spectator_joined',
        actorSocketId: socket.id,
        actorUserId: userId,
        payload: {
          username,
        },
      });

      cb?.({
        ok: true,
        roomCode: code,
        players: roster,
        eventMeta: getRoomMatchEventMeta(code),
        matchStarted: Boolean(room.state),
      });
    } catch (e) {
      cb?.({ ok: false, error: 'spectate_failed' });
    }
  });
}