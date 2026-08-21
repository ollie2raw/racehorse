/**
 * Presence, held in memory, as the single source of truth.
 *
 * This previously mirrored into a `player_presence` table. That table was never
 * created in the deployed database, so every write and read returned PGRST205
 * and was swallowed by a `.catch(() => {})` — friend presence read as offline
 * for everyone, and the socket path was doing all the real work anyway.
 *
 * The deployment is single-instance, so the socket map *is* the authority:
 * a user is online exactly when they hold at least one connected socket. That
 * removes an entire class of drift, since HTTP and socket callers now answer
 * from the same structure instead of two that could disagree.
 *
 * If this ever runs multi-instance, presence has to move to something shared
 * (Redis, or the Socket.IO adapter's room membership) — an in-process Map
 * cannot see sockets held by another node.
 */

export type PresenceStatus = 'online' | 'in_game' | 'offline';

/** userId → the socket ids that user currently holds. */
export const socketsByUserId = new Map<string, Set<string>>();

/** userId → activity, only meaningful while the user holds a socket. */
const activityByUserId = new Map<string, { status: Exclude<PresenceStatus, 'offline'>; mode: string | null }>();

export function addSocket(userId: string, socketId: string): void {
  const existing = socketsByUserId.get(userId) ?? new Set<string>();
  existing.add(socketId);
  socketsByUserId.set(userId, existing);
}

/**
 * Drop one socket. Returns true when that was the user's last one — the only
 * point at which they actually became offline.
 */
export function removeSocket(userId: string, socketId: string): boolean {
  const set = socketsByUserId.get(userId);
  if (!set) return false;
  set.delete(socketId);
  if (set.size > 0) return false;
  socketsByUserId.delete(userId);
  activityByUserId.delete(userId);
  return true;
}

export function isOnline(userId: string): boolean {
  return (socketsByUserId.get(userId)?.size ?? 0) > 0;
}

/** Record what an online user is doing. Ignored for users with no socket. */
export function setActivity(
  userId: string,
  status: Exclude<PresenceStatus, 'offline'>,
  mode: string | null = null,
): void {
  if (!isOnline(userId)) return;
  activityByUserId.set(userId, { status, mode });
}

export function getPresence(userId: string): { status: PresenceStatus; current_mode: string | null } {
  if (!isOnline(userId)) return { status: 'offline', current_mode: null };
  const activity = activityByUserId.get(userId);
  return { status: activity?.status ?? 'online', current_mode: activity?.mode ?? null };
}

export function getPresenceBatch(
  userIds: string[],
): Map<string, { status: PresenceStatus; current_mode: string | null }> {
  return new Map(userIds.map((id) => [id, getPresence(id)]));
}

/** Number of users currently holding at least one socket. */
export function onlineUserCount(): number {
  return socketsByUserId.size;
}

/** Test-only: drop all presence state. */
export function resetPresenceRegistry(): void {
  socketsByUserId.clear();
  activityByUserId.clear();
}
