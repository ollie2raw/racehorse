import type { Server, Socket } from 'socket.io';
import type { AckFn, RoomJoinConfig } from '../multiplayer/roomSession';
import { supabaseFetch } from '../supabaseUtils';
import { upsertPresence } from './presence';

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

export function createRemoveSocketPresence(
  socket: Socket,
  socketsByUserId: Map<string, Set<string>>,
  normalizeUserId: PresenceHandlerDeps['normalizeUserId'],
): () => void {
  return () => {
    const userId = normalizeUserId(socket.data?.userId);
    if (!userId) return;
    const set = socketsByUserId.get(userId);
    if (!set) return;
    set.delete(socket.id);
    if (set.size === 0) socketsByUserId.delete(userId);
  };
}

export function registerPresenceHandlers(
  socket: Socket,
  deps: PresenceHandlerDeps,
): {
  removeSocketPresence: () => void;
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
        console.log('[presence] identify received', userId);
        removeSocketPresence();
        socket.data.userId = userId;
        socket.data.username = username;
        const existing = deps.socketsByUserId.get(userId) ?? new Set<string>();
        existing.add(socket.id);
        deps.socketsByUserId.set(userId, existing);
        void upsertPresence(userId, 'online').catch(() => {});
        emitPresenceUpdateToFriends(deps, userId, 'online');
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
    const onlineUserIds = userIds.filter((id) => (deps.socketsByUserId.get(id)?.size ?? 0) > 0);
    console.log(
      '[presence] online check',
      JSON.stringify({
        requested: userIds.length,
        online: onlineUserIds.length,
        registeredUsers: deps.socketsByUserId.size,
      }),
    );
    cb?.({ ok: true, onlineUserIds });
  });

  const handlePresenceDisconnect = () => {
    removeSocketPresence();
    const userId = deps.normalizeUserId(socket.data?.userId);
    if (deps.isUuidLike(userId)) {
      void upsertPresence(userId as string, 'offline').catch(() => {});
      emitPresenceUpdateToFriends(deps, userId as string, 'offline');
    }
  };

  return { removeSocketPresence, handlePresenceDisconnect };
}