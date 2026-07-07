import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { matchmakingSocketScopeRef } from './matchmakingSocketScope';
import type { OnlineCountEvent } from './types';

/**
 * Read-only global queue / online counts for UI (e.g. multiplayer top bar on Private lobby).
 * Socket ingress is owned by registerMatchmakingSocketHandlers — this hook assigns delegates only.
 */
export function useQueueCounts(socket: Socket | null, enabled: boolean): { online: number; queued: number } {
  const [online, setOnline] = useState(0);
  const [queued, setQueued] = useState(0);

  const apply = useCallback((o?: number, q?: number) => {
    if (typeof o === 'number') setOnline(o);
    if (typeof q === 'number') setQueued(q);
  }, []);

  const handleQueueOnline = useCallback((evt: OnlineCountEvent) => {
    apply(evt?.online, evt?.queued);
  }, [apply]);

  const handleConnect = useCallback(() => {
    if (!socket?.connected) return;
    socket.emit('queue:online', {}, (resp: { online?: number; queued?: number } | undefined) => {
      apply(resp?.online, resp?.queued);
    });
  }, [socket, apply]);

  useLayoutEffect(() => {
    if (enabled && socket) {
      matchmakingSocketScopeRef.current.queueCounts = {
        onQueueOnline: handleQueueOnline,
        onConnect: handleConnect,
      };
    } else {
      matchmakingSocketScopeRef.current.queueCounts = null;
    }
  }, [enabled, socket, handleQueueOnline, handleConnect]);

  useEffect(() => {
    if (!enabled || !socket) return;
    socket.emit('queue:online', {}, (resp: { online?: number; queued?: number } | undefined) => {
      apply(resp?.online, resp?.queued);
    });
    return () => {
      matchmakingSocketScopeRef.current.queueCounts = null;
    };
  }, [socket, enabled, apply]);

  useEffect(() => {
    return () => {
      matchmakingSocketScopeRef.current.queueCounts = null;
    };
  }, []);

  return { online, queued };
}