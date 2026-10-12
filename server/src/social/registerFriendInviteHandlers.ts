import type { Server, Socket } from 'socket.io';
import { getRoom } from '../rooms';
import { getRoomRoster } from '../multiplayer/roomSession';
import { isBlockedPairOrFalse } from '../moderation/blockStore';

type AckFn = (payload: unknown) => void;

/** Mirrors the client's FRIEND_CHALLENGE_MATCH_SUMMARY (`client/src/multiplayer/friendChallenge.ts`). */
export const FRIEND_INVITE_MATCH_SUMMARY = '7-Tile · First to 60 · Untimed';

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
  socket.on('friend:invite', async (payload: FriendInvitePayload, cb?: AckFn) => {
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

    // A block in either direction: answered exactly like an offline friend, so
    // the inviter can't tell they were blocked.
    if (await isBlockedPairOrFalse(inviterUserId!, toUserId, 'friend:invite')) {
      cb?.({ ok: false, error: 'recipient_unreachable' });
      return;
    }

    const inviteId = String(payload?.inviteId ?? `${Date.now()}-${roomCode}`).slice(0, 80);
    const inviterUsername = deps.normalizeUsername(socket.data?.username);

    for (const socketId of targetSockets) {
      io.to(socketId).emit('friend:invited', {
        inviteId,
        fromUsername: inviterUsername,
        fromUserId: inviterUserId,
        roomCode,
        // Fixed server text. The sender's `matchSummary` / `inviteUrl` are
        // ignored: relaying them let any player put arbitrary text on another
        // player's screen (App Store Guideline 1.2).
        inviteUrl: '',
        matchSummary: FRIEND_INVITE_MATCH_SUMMARY,
      });
    }

    cb?.({ ok: true, delivered: true, inviteId });
  });
}
