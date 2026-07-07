import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Socket } from 'socket.io-client';
import { registerRawSocketEventHandler } from './socketEventBus';
import { SOCKET_EVENTS } from './socketEventRegistry';

type UseFriendSocketReachabilityParams = {
  socket: Socket | null;
  userIds: string[];
  enabled?: boolean;
  pollMs?: number;
};

const EMPTY_REACHABLE_SET = new Set<string>();

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function subscribeSocketConnection(_socket: Socket | null, onStoreChange: () => void): () => void {
  if (!_socket) return () => {};
  const handleConnect = () => onStoreChange();
  const handleDisconnect = () => onStoreChange();
  const unregisterConnect = registerRawSocketEventHandler(SOCKET_EVENTS.CONNECT, handleConnect);
  const unregisterDisconnect = registerRawSocketEventHandler(
    SOCKET_EVENTS.DISCONNECT,
    handleDisconnect,
  );
  return () => {
    unregisterConnect();
    unregisterDisconnect();
  };
}

function getSocketConnectedSnapshot(socket: Socket | null): boolean {
  return Boolean(socket?.connected);
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
  const isConnected = useSyncExternalStore(
    (onStoreChange) => subscribeSocketConnection(socket, onStoreChange),
    () => getSocketConnectedSnapshot(socket),
    () => false,
  );

  const stableUserIds = useMemo(
    () => [...new Set(userIds.filter((id) => id && !id.startsWith('demo-')))].sort(),
    [userIds],
  );

  const pollEnabled = enabled && Boolean(socket) && stableUserIds.length > 0;

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
    if (!pollEnabled) return;

    let active = true;

    const refresh = () => {
      if (!isVisible) return;
      if (!isConnected) {
        setReachableIds((prev) => (prev.size === 0 ? prev : new Set()));
        setHasSnapshot((prev) => (prev ? false : prev));
        return;
      }
      socket!.emit(
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

    void (async () => {
      await Promise.resolve();
      if (!active) return;
      refresh();
    })();

    if (!isConnected || !isVisible) {
      return () => {
        active = false;
      };
    }

    const interval = window.setInterval(refresh, pollMs);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [isConnected, isVisible, pollEnabled, pollMs, socket, stableUserIds]);

  const displayReachableIds = pollEnabled ? reachableIds : EMPTY_REACHABLE_SET;
  const displayHasSnapshot = pollEnabled ? hasSnapshot : false;

  const isSocketReachable = useMemo(
    () => (userId: string) => {
      if (!userId || userId.startsWith('demo-')) return false;
      if (!displayHasSnapshot) return false;
      return displayReachableIds.has(userId);
    },
    [displayHasSnapshot, displayReachableIds],
  );

  return {
    isSocketReachable,
    hasReachabilitySnapshot: displayHasSnapshot,
    reachableIds: displayReachableIds,
  };
}
