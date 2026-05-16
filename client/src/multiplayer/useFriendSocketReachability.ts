import { useEffect, useMemo, useState } from 'react';
import type { Socket } from 'socket.io-client';

type UseFriendSocketReachabilityParams = {
  socket: Socket | null;
  userIds: string[];
  enabled?: boolean;
  pollMs?: number;
};

/**
 * Socket-deliverable presence: friends who have an active socket registered for friend:invite.
 * Distinct from API presence_status (can show online before socket is identifiable).
 */
export function useFriendSocketReachability({
  socket,
  userIds,
  enabled = true,
  pollMs = 15_000,
}: UseFriendSocketReachabilityParams) {
  const [reachableIds, setReachableIds] = useState<Set<string>>(new Set());
  const [hasSnapshot, setHasSnapshot] = useState(false);

  const stableUserIds = useMemo(
    () => [...new Set(userIds.filter((id) => id && !id.startsWith('demo-')))].sort(),
    [userIds],
  );

  useEffect(() => {
    if (!enabled || !socket || stableUserIds.length === 0) {
      setReachableIds(new Set());
      setHasSnapshot(false);
      return;
    }

    let active = true;

    const refresh = () => {
      if (!socket.connected) {
        setReachableIds(new Set());
        setHasSnapshot(false);
        return;
      }
      socket.emit(
        'presence:online',
        stableUserIds,
        (resp: { ok?: boolean; onlineUserIds?: string[] }) => {
          if (!active || !resp?.ok) return;
          setReachableIds(new Set(resp.onlineUserIds ?? []));
          setHasSnapshot(true);
        },
      );
    };

    refresh();
    const interval = window.setInterval(refresh, pollMs);
    socket.on('connect', refresh);

    return () => {
      active = false;
      window.clearInterval(interval);
      socket.off('connect', refresh);
    };
  }, [enabled, pollMs, socket, stableUserIds]);

  const isSocketReachable = useMemo(
    () => (userId: string) => {
      if (!userId || userId.startsWith('demo-')) return false;
      if (!hasSnapshot) return false;
      return reachableIds.has(userId);
    },
    [hasSnapshot, reachableIds],
  );

  return {
    isSocketReachable,
    hasReachabilitySnapshot: hasSnapshot,
    reachableIds,
  };
}
