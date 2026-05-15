import { useCallback, useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { OnlineCountEvent } from './types';

/**
 * Read-only global queue / online counts for UI (e.g. multiplayer top bar on Private lobby).
 */
export function useQueueCounts(socket: Socket | null, enabled: boolean): { online: number; queued: number } {
  const [online, setOnline] = useState(0);
  const [queued, setQueued] = useState(0);

  const apply = useCallback((o?: number, q?: number) => {
    if (typeof o === 'number') setOnline(o);
    if (typeof q === 'number') setQueued(q);
  }, []);

  useEffect(() => {
    if (!enabled || !socket) return;

    const onEvt = (evt: OnlineCountEvent) => {
      apply(evt?.online, evt?.queued);
    };
    socket.on('queue:online', onEvt);
    socket.emit('queue:online', {}, (resp: { online?: number; queued?: number } | undefined) => {
      apply(resp?.online, resp?.queued);
    });
    return () => {
      socket.off('queue:online', onEvt);
    };
  }, [socket, enabled, apply]);

  useEffect(() => {
    if (!enabled || !socket) return;
    const onConnect = () => {
      socket.emit('queue:online', {}, (resp: { online?: number; queued?: number } | undefined) => {
        apply(resp?.online, resp?.queued);
      });
    };
    socket.on('connect', onConnect);
    return () => {
      socket.off('connect', onConnect);
    };
  }, [socket, enabled, apply]);

  return { online, queued };
}
