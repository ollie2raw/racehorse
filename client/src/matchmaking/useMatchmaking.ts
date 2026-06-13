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
  searchStartedAtMs: number | null;
  online: number;
  queued: number;
  matched: MatchFoundPayload | null;
  error: string | null;
  findMatch: () => void;
  cancel: () => void;
  acceptTimeoutBotFallback: () => void;
  reset: () => void;
  /** Ask the server for current online / queue counts (also used on socket connect). */
  refreshOnlineCounts: () => void;
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
  const [searchStartedAtMs, setSearchStartedAtMs] = useState<number | null>(null);
  const [online, setOnline] = useState(0);
  const [queued, setQueued] = useState(0);
  const [matched, setMatched] = useState<MatchFoundPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onMatchReadyRef = useRef(onMatchReady);
  /** Guards stale queue:join ack / timeout after cancel or disconnect */
  const joinGenerationRef = useRef(0);
  const joinAckTimerRef = useRef<number | null>(null);
  const queueUiStateRef = useRef<QueueUiState>(state);

  // Keep callback ref fresh so we don't re-subscribe on every render.
  useEffect(() => { onMatchReadyRef.current = onMatchReady; }, [onMatchReady]);
  useEffect(() => {
    queueUiStateRef.current = state;
  }, [state]);

  const clearJoinAckTimer = useCallback(() => {
    if (joinAckTimerRef.current != null) {
      window.clearTimeout(joinAckTimerRef.current);
      joinAckTimerRef.current = null;
    }
  }, []);

  const applyOnlineAck = useCallback((resp: { online?: number; queued?: number } | undefined) => {
    if (typeof resp?.online === 'number') setOnline(resp.online);
    if (typeof resp?.queued === 'number') setQueued(resp.queued);
  }, []);

  const refreshOnlineCounts = useCallback(() => {
    if (!socket?.connected) return;
    socket.emit('queue:online', {}, (resp: { online?: number; queued?: number } | undefined) => {
      applyOnlineAck(resp);
    });
  }, [socket, applyOnlineAck]);

  useEffect(() => {
    if (!socket) return;
    const handleOnline = (evt: OnlineCountEvent) => {
      setOnline(evt?.online ?? 0);
      setQueued(evt?.queued ?? 0);
    };
    const handleMatched = (payload: MatchFoundPayload) => {
      clearJoinAckTimer();
      setMatched(payload);
      setState('matched');
      onMatchReadyRef.current(payload);
    };
    const handleTimeout = () => {
      clearJoinAckTimer();
      setState('timeout');
    };
    const handleDisconnect = () => {
      clearJoinAckTimer();
      joinGenerationRef.current += 1;
      setOnline(0);
      setQueued(0);
      const prev = queueUiStateRef.current;
      if (prev === 'searching' || prev === 'matched') {
        setSearchStartedAtMs(null);
        setError('Lost connection to the game server.');
        setState('idle');
      }
    };
    const handleConnect = () => {
      socket.emit('queue:online', {}, (resp: { online?: number; queued?: number } | undefined) => {
        applyOnlineAck(resp);
      });
    };
    socket.on('queue:online', handleOnline);
    socket.on('queue:matched', handleMatched);
    socket.on('queue:timeout', handleTimeout);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect', handleConnect);
    return () => {
      socket.off('queue:online', handleOnline);
      socket.off('queue:matched', handleMatched);
      socket.off('queue:timeout', handleTimeout);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect', handleConnect);
    };
  }, [socket, clearJoinAckTimer, applyOnlineAck]);

  const findMatch = useCallback(() => {
    if (!socket?.connected) {
      setError('Not connected to the game server. Open Multiplayer again or check your connection.');
      return;
    }
    if (!identity) {
      setError('Sign in to find a match.');
      return;
    }
    setError(null);
    setMatched(null);
    clearJoinAckTimer();
    const gen = (joinGenerationRef.current += 1);
    setState('searching');
    setSearchStartedAtMs(Date.now());
    joinAckTimerRef.current = window.setTimeout(() => {
      joinAckTimerRef.current = null;
      if (joinGenerationRef.current !== gen) return;
      setError(
        'Matchmaking did not respond. The socket may be disconnected (try leaving Multiplayer and returning) or the server is slow to wake (Render free tier).',
      );
      setState('idle');
      setSearchStartedAtMs(null);
    }, 22_000);
    socket.emit('queue:join', identity, (resp: { ok: boolean; error?: string; online?: number; queued?: number } | undefined) => {
      if (joinGenerationRef.current !== gen) return;
      clearJoinAckTimer();
      applyOnlineAck(resp);
      if (!resp?.ok) {
        setError(resp?.error ?? 'Failed to join queue.');
        setState('idle');
        setSearchStartedAtMs(null);
      }
    });
  }, [socket, identity, clearJoinAckTimer, applyOnlineAck]);

  const cancel = useCallback(() => {
    joinGenerationRef.current += 1;
    clearJoinAckTimer();
    setSearchStartedAtMs(null);
    setState('idle');
    setError(null);
    if (socket?.connected) {
      socket.emit('queue:leave', {}, () => undefined);
    }
  }, [socket, clearJoinAckTimer]);

  const acceptTimeoutBotFallback = useCallback(() => {
    clearJoinAckTimer();
    setSearchStartedAtMs(null);
    setState('idle');
  }, [clearJoinAckTimer]);

  const reset = useCallback(() => {
    joinGenerationRef.current += 1;
    clearJoinAckTimer();
    setSearchStartedAtMs(null);
    setMatched(null);
    setError(null);
    setState('idle');
  }, [clearJoinAckTimer]);

  useEffect(() => () => {
    clearJoinAckTimer();
  }, [clearJoinAckTimer]);

  return {
    state,
    searchStartedAtMs,
    online,
    queued,
    matched,
    error,
    findMatch,
    cancel,
    acceptTimeoutBotFallback,
    reset,
    refreshOnlineCounts,
  };
}
