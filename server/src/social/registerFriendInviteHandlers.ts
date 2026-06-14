import type { Server, Socket } from 'socket.io';
import { getRoom } from '../rooms';
import { getRoomRoster } from '../multiplayer/roomSession';

type AckFn = (payload: unknown) => void;

type FriendInvitePayload = {
  toUserId?: string;
  fromUsername?: string;
  fromUserId?: string;
  roomCode?: string;
  inviteUrl?: string;
  inviteId?: string;
  matchSummary?: string;
};

type FriendInviteHandlerDeps = {
  normalizeUserId: (value: unknown) => string | null;
  normalizeUsername: (value: unknown) => string;
  isAuthenticatedUserId: (value: string | null | undefined) => boolean;
};

export function registerFriendInviteHandlers(
  io: Server,
  socket: Socket,
  socketsByUserId: Map<string, Set<string>>,
  deps: FriendInviteHandlerDeps,
): void {
  socket.on('friend:invite', (payload: FriendInvitePayload, cb?: AckFn) => {
    const roomCode = String(payload?.roomCode ?? '').trim().toUpperCase();
    try {
      getRoom(roomCode);
    } catch {
      socket.emit('friend:invite:error', { ok: false, error: 'room_not_found' });
      cb?.({ ok: false, error: 'room_not_found' });
      return;
    }

    const inviterUserId = deps.normalizeUserId(socket.data?.userId);
    if (!deps.isAuthenticatedUserId(inviterUserId)) {
      cb?.({ ok: false, error: 'not_authenticated' });
      return;
    }

    const roster = getRoomRoster(roomCode);
    const isRoomMember = roster.some((player) => player.userId === inviterUserId);
    if (!isRoomMember) {
      cb?.({ ok: false, error: 'not_room_member' });
      return;
    }

    const toUserId = deps.normalizeUserId(payload?.toUserId);
    if (!toUserId) {
      cb?.({ ok: false, error: 'invalid_target' });
      return;
    }

    const targetSockets = socketsByUserId.get(toUserId);
    if (!targetSockets || targetSockets.size === 0) {
      cb?.({ ok: false, error: 'recipient_unreachable' });
      return;
    }

    const inviteId = String(payload?.inviteId ?? `${Date.now()}-${roomCode}`).slice(0, 80);
    const matchSummary = String(payload?.matchSummary ?? '7-Tile · First to 60 · Untimed').slice(0, 120);
    const inviteUrl = String(payload?.inviteUrl ?? '');
    const inviterUsername = deps.normalizeUsername(socket.data?.username);

    for (const socketId of targetSockets) {
      io.to(socketId).emit('friend:invited', {
        inviteId,
        fromUsername: inviterUsername,
        fromUserId: inviterUserId,
        roomCode,
        inviteUrl,
        matchSummary,
      });
    }

    cb?.({ ok: true, delivered: true, inviteId });
  });
}
