import { childLogger } from '../logger';
import type { Socket } from 'socket.io';
import { appendRoomEvent } from '../roomEvents';
import { createRoom, getRoomMatchEventMeta } from '../rooms';
import { schedulePersistLiveRoomSessionForRoom } from './roomLivePersistence';
import { sanitizePrivateRoomConfig } from './privateRoomConfig';
import {
  allocatePlayerSeatId,
  clearSocketRematchReady,
  ensureSocketDataSeat,
  setRoomRoster,
  type AckFn,
  type RoomJoinConfig,
  type RoomPlayer,
  type RoomSessionHandlerDeps,
} from './roomSession';

const log = childLogger('multiplayer:lifecycle');

export type LeaveTrackedRoomFn = (
  roomCode: string | undefined,
  options?: { preserveSeat?: boolean },
) => Promise<void>;

export type RegisterRoomLifecycleHandlersParams = {
  handlerDeps: RoomSessionHandlerDeps;
  leaveExistingSocketRooms: () => void;
  leaveTrackedRoom: LeaveTrackedRoomFn;
};

export function registerRoomLifecycleHandlers(
  socket: Socket,
  params: RegisterRoomLifecycleHandlersParams,
): void {
  const { handlerDeps, leaveExistingSocketRooms, leaveTrackedRoom } = params;

  socket.on('room:create', async (arg1?: unknown, arg2?: unknown) => {
    const config = (
      arg1 && typeof arg1 === 'object' && !Array.isArray(arg1) ? arg1 : {}
    ) as RoomJoinConfig;
    const cb = (typeof arg1 === 'function' ? arg1 : arg2) as AckFn | undefined;
    const {
      username: _ignoredUsername,
      userId: _ignoredUserId,
      authToken: _ignoredAuthToken,
      ...roomConfig
    } = config as Record<string, unknown>;
    log.info(`[room:create] socket=${socket.id}`);
    try {
      const { username, userId } = await handlerDeps.resolveSocketIdentity(config);
      clearSocketRematchReady((socket.data?.roomId as string | undefined) ?? undefined, socket.id);
      leaveExistingSocketRooms();
      const playerSeatId = allocatePlayerSeatId();
      const room = createRoom(playerSeatId, sanitizePrivateRoomConfig(roomConfig));
      socket.join(room.code);
      socket.data.roomId = room.code;
      socket.data.username = username;
      socket.data.userId = userId;
      ensureSocketDataSeat(socket, playerSeatId);
      const roomPlayers: RoomPlayer[] = [{ id: playerSeatId, socketId: socket.id, username, userId }];
      setRoomRoster(room.code, roomPlayers);
      schedulePersistLiveRoomSessionForRoom(room);
      appendRoomEvent(room, {
        type: 'player_joined',
        actorSocketId: socket.id,
        actorUserId: userId,
        payload: {
          username,
          via: 'room:create',
        },
      });
      log.info(`[room:create] created room=${room.code}, players=${room.players.length}`);
      cb?.({
        ok: true,
        roomCode: room.code,
        you: playerSeatId,
        players: roomPlayers,
        eventMeta: getRoomMatchEventMeta(room.code),
        matchStarted: false,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      log.info(`[room:create] ERROR: ${message}`);
      cb?.({ ok: false, error: message });
    }
  });

  socket.on('room:leave', async (roomCode: unknown, cb?: AckFn) => {
    const code = typeof roomCode === 'string' ? roomCode.trim().toUpperCase() : '';
    if (!code) {
      cb?.({ ok: false, error: 'missing_code' });
      return;
    }

    try {
      await leaveTrackedRoom(code);
      cb?.({ ok: true, roomCode: code });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'leave_failed';
      cb?.({ ok: false, error: message });
    }
  });
}