import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { MatchFoundPayload, OnlineCountEvent, QueueUiState } from './types';

type Identity = { userId: string; username: string } | null;

export type UseMatchmakingArgs = {
  socket: Socket | null;
  identity: Identity;
  onMatchReady: (payload: MatchFoundPayload) => void;
};

export type UseMatchmakingReturn = {
  state: QueueUiState;
  elapsedMs: number;
  online: number;
  queued: number;
  matched: MatchFoundPayload | null;
  error: string | null;
  findMatch: () => void;
  cancel: () => void;
  acceptTimeoutBotFallback: () => void;
  reset: () => void;
};

/**
 * React hook around the matchmaking socket protocol.
 *
 *   queue:join   →  put me in the queue
 *   queue:leave  →  pull me out
 *   queue:matched (server-pushed) →  match found, fire `onMatchReady`
 *   queue:timeout (server-pushed) →  90s elapsed, no match
 *   queue:online  (server-pushed) →  global online + queue count
 */
export function useMatchmaking({ socket, identity, onMatchReady }: UseMatchmakingArgs): UseMatchmakingReturn {
  const [state, setState] = useState<QueueUiState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [online, setOnline] = useState(0);
  const [queued, setQueued] = useState(0);
  const [matched, setMatched] = useState<MatchFoundPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const elapsedTimer = useRef<number | null>(null);
  const startMsRef = useRef<number>(0);
  const onMatchReadyRef = useRef(onMatchReady);

  // Keep callback ref fresh so we don't re-subscribe on every render.
  useEffect(() => { onMatchReadyRef.current = onMatchReady; }, [onMatchReady]);

  useEffect(() => {
    if (!socket) return;
    const handleOnline = (evt: OnlineCountEvent) => {
      setOnline(evt?.online ?? 0);
      setQueued(evt?.queued ?? 0);
    };
    const handleMatched = (payload: MatchFoundPayload) => {
      stopElapsedTimer();
      setMatched(payload);
      setState('matched');
      onMatchReadyRef.current(payload);
    };
    const handleTimeout = () => {
      stopElapsedTimer();
      setState('timeout');
    };
    socket.on('queue:online', handleOnline);
    socket.on('queue:matched', handleMatched);
    socket.on('queue:timeout', handleTimeout);
    return () => {
      socket.off('queue:online', handleOnline);
      socket.off('queue:matched', handleMatched);
      socket.off('queue:timeout', handleTimeout);
    };
  }, [socket]);

  const startElapsedTimer = useCallback(() => {
    startMsRef.current = Date.now();
    setElapsedMs(0);
    if (elapsedTimer.current !== null) window.clearInterval(elapsedTimer.current);
    elapsedTimer.current = window.setInterval(() => {
      setElapsedMs(Date.now() - startMsRef.current);
    }, 250);
  }, []);

  const stopElapsedTimer = () => {
    if (elapsedTimer.current !== null) {
      window.clearInterval(elapsedTimer.current);
      elapsedTimer.current = null;
    }
  };

  const findMatch = useCallback(() => {
    if (!socket) {
      setError('Not connected.');
      return;
    }
    if (!identity) {
      setError('Sign in to find a match.');
      return;
    }
    setError(null);
    setMatched(null);
    setState('searching');
    startElapsedTimer();
    socket.emit('queue:join', identity, (resp: { ok: boolean; error?: string } | undefined) => {
      if (!resp?.ok) {
        setError(resp?.error ?? 'Failed to join queue.');
        setState('idle');
        stopElapsedTimer();
      }
    });
  }, [socket, identity, startElapsedTimer]);

  const cancel = useCallback(() => {
    if (!socket) return;
    socket.emit('queue:leave', {}, () => {
      stopElapsedTimer();
      setState('idle');
    });
  }, [socket]);

  const acceptTimeoutBotFallback = useCallback(() => {
    stopElapsedTimer();
    setState('idle');
  }, []);

  const reset = useCallback(() => {
    stopElapsedTimer();
    setMatched(null);
    setError(null);
    setState('idle');
  }, []);

  useEffect(() => () => stopElapsedTimer(), []);

  return { state, elapsedMs, online, queued, matched, error, findMatch, cancel, acceptTimeoutBotFallback, reset };
}
