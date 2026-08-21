import { childLogger } from '../logger';
import type { Server, Socket } from 'socket.io';
import type { AckFn, RoomJoinConfig } from '../multiplayer/roomSession';
import { supabaseFetch } from '../supabaseUtils';
import { addSocket, isOnline, removeSocket } from './presenceRegistry';

const log = childLogger('presence');

export type PresenceHandlerDeps = {
  io: Server;
  socketsByUserId: Map<string, Set<string>>;
  resolveSocketIdentity: (config: RoomJoinConfig) => Promise<{ username: string; userId: string | null }>;
  normalizeUserId: (value: unknown) => string | null;
  isUuidLike: (value: string | null | undefined) => boolean;
};

// Emit presence:update to all sockets of friends who are currently connected.
export function emitPresenceUpdateToFriends(
  deps: Pick<PresenceHandlerDeps, 'io' | 'socketsByUserId'>,
  userId: string,
  status: string,
): void {
  void (async () => {
    try {
      const enc = encodeURIComponent(userId);
      const rows = await supabaseFetch<Array<{ user_id: string; friend_user_id: string }>>(
        `/rest/v1/friends?or=(user_id.eq.${enc},friend_user_id.eq.${enc})` +
          `&status=eq.accepted&select=user_id,friend_user_id`,
      );
      for (const r of rows) {
        const friendId = r.user_id === userId ? r.friend_user_id : r.user_id;
        const friendSockets = deps.socketsByUserId.get(friendId);
        if (!friendSockets?.size) continue;
        for (const socketId of friendSockets) {
          deps.io.to(socketId).emit('presence:update', { userId, status });
        }
      }
    } catch {
      /* non-critical */
    }
  })();
}

/**
 * Detach this socket from its user. Returns true only when it was that user's
 * last socket — the one case where they actually went offline.
 */
export function createRemoveSocketPresence(
  socket: Socket,
  _socketsByUserId: Map<string, Set<string>>,
  normalizeUserId: PresenceHandlerDeps['normalizeUserId'],
): () => boolean {
  return () => {
    const userId = normalizeUserId(socket.data?.userId);
    if (!userId) return false;
    return removeSocket(userId, socket.id);
  };
}

export function registerPresenceHandlers(
  socket: Socket,
  deps: PresenceHandlerDeps,
): {
  removeSocketPresence: () => boolean;
  handlePresenceDisconnect: () => void;
} {
  const removeSocketPresence = createRemoveSocketPresence(
    socket,
    deps.socketsByUserId,
    deps.normalizeUserId,
  );

  socket.on(
    'presence:identify',
    async (payload: RoomJoinConfig, cb?: AckFn) => {
      try {
        const { username, userId } = await deps.resolveSocketIdentity(payload ?? {});
        if (!userId) return cb?.({ ok: false });
        // Re-identify is routine: it fires on every reconnect and on every
        // access-token rotation. Only announce a transition the friends list
        // has not already been told about.
        const wasOnline = isOnline(userId);
        removeSocketPresence();
        socket.data.userId = userId;
        socket.data.username = username;
        addSocket(userId, socket.id);
        if (!wasOnline) {
          log.info({ userId }, 'presence identify received');
          emitPresenceUpdateToFriends(deps, userId, 'online');
        }
        cb?.({ ok: true });
      } catch {
        cb?.({ ok: false });
      }
    },
  );

  socket.on('presence:online', (argUserIds: unknown, cb?: AckFn) => {
    const userIds = Array.isArray(argUserIds)
      ? argUserIds
          .map((id) => deps.normalizeUserId(id))
          .filter((id): id is string => Boolean(id))
      : [];
    const onlineUserIds = userIds.filter((id) => isOnline(id));
    log.info({
      requested: userIds.length,
      online: onlineUserIds.length,
      registeredUsers: deps.socketsByUserId.size,
    }, 'presence online check');
    cb?.({ ok: true, onlineUserIds });
  });

  const handlePresenceDisconnect = () => {
    const userId = deps.normalizeUserId(socket.data?.userId);
    // removeSocketPresence reports whether this was the user's last socket.
    // Announcing offline unconditionally marked a player offline whenever any
    // one of their tabs closed, while they were still connected in another.
    const wentOffline = removeSocketPresence();
    if (wentOffline && deps.isUuidLike(userId)) {
      emitPresenceUpdateToFriends(deps, userId as string, 'offline');
    }
  };

  return { removeSocketPresence, handlePresenceDisconnect };
}