import { useEffect, useMemo, useState } from 'react';
import type { Socket } from 'socket.io-client';

type UseFriendSocketReachabilityParams = {
  socket: Socket | null;
  userIds: string[];
  enabled?: boolean;
  pollMs?: number;
};

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

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
  const [isVisible, setIsVisible] = useState(
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  );
  const [isConnected, setIsConnected] = useState(Boolean(socket?.connected));

  const stableUserIds = useMemo(
    () => [...new Set(userIds.filter((id) => id && !id.startsWith('demo-')))].sort(),
    [userIds],
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleVisibilityChange = () => {
      setIsVisible(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!socket) {
      setIsConnected(false);
      return;
    }

    const handleConnect = () => setIsConnected(true);
    const handleDisconnect = () => setIsConnected(false);

    setIsConnected(socket.connected);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
    };
  }, [socket]);

  useEffect(() => {
    if (!enabled || !socket || stableUserIds.length === 0) {
      setReachableIds((prev) => (prev.size === 0 ? prev : new Set()));
      setHasSnapshot((prev) => (prev ? false : prev));
      return;
    }

    let active = true;

    const refresh = () => {
      if (!isVisible) return;
      if (!isConnected) {
        setReachableIds((prev) => (prev.size === 0 ? prev : new Set()));
        setHasSnapshot((prev) => (prev ? false : prev));
        return;
      }
      socket.emit(
        'presence:online',
        stableUserIds,
        (resp: { ok?: boolean; onlineUserIds?: string[] }) => {
          if (!active || !resp?.ok) return;
          const nextReachable = new Set(resp.onlineUserIds ?? []);
          setReachableIds((prev) => (setsEqual(prev, nextReachable) ? prev : nextReachable));
          setHasSnapshot((prev) => (prev ? prev : true));
        },
      );
    };

    refresh();
    if (!isConnected || !isVisible) return () => {
      active = false;
    };

    const interval = window.setInterval(refresh, pollMs);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [enabled, isConnected, isVisible, pollMs, socket, stableUserIds]);

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
