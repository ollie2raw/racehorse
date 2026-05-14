import { useCallback, useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import * as api from './tournamentApi';
import type {
  BracketView,
  MatchReadyEvent,
  Registration,
  ScheduledTournament,
} from './types';

type Args = { socket: Socket | null; userId: string | null };

export function useTournament({ socket, userId }: Args) {
  const [upcoming, setUpcoming] = useState<ScheduledTournament[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [activeBracket, setActiveBracket] = useState<BracketView | null>(null);
  const [pendingMatch, setPendingMatch] = useState<MatchReadyEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [u, r] = await Promise.all([
        api.fetchUpcoming(),
        userId ? api.fetchMyRegistrations(userId) : Promise.resolve([] as Registration[]),
      ]);
      setUpcoming(u);
      setRegistrations(r);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tournaments');
    }
  }, [userId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!socket) return;
    const onRegOpen = () => { void refresh(); };
    const onRegUpdated = () => { void refresh(); };
    const onBracket = (payload: { tournamentId: string }) => {
      void api.fetchBracket(payload.tournamentId).then(setActiveBracket).catch(() => undefined);
    };
    const onMatchUpdated = (payload: { tournamentId: string }) => {
      void api.fetchBracket(payload.tournamentId).then(setActiveBracket).catch(() => undefined);
    };
    const onMatchReady = (payload: MatchReadyEvent) => { setPendingMatch(payload); };
    const onCompleted = (payload: { tournamentId: string }) => {
      void api.fetchBracket(payload.tournamentId).then(setActiveBracket).catch(() => undefined);
    };
    socket.on('tournament:registration_open', onRegOpen);
    socket.on('tournament:registration_updated', onRegUpdated);
    socket.on('tournament:bracket_generated', onBracket);
    socket.on('tournament:match_updated', onMatchUpdated);
    socket.on('tournament:match_ready', onMatchReady);
    socket.on('tournament:completed', onCompleted);
    return () => {
      socket.off('tournament:registration_open', onRegOpen);
      socket.off('tournament:registration_updated', onRegUpdated);
      socket.off('tournament:bracket_generated', onBracket);
      socket.off('tournament:match_updated', onMatchUpdated);
      socket.off('tournament:match_ready', onMatchReady);
      socket.off('tournament:completed', onCompleted);
    };
  }, [socket, refresh]);

  const register = useCallback(async (tournamentId: string) => {
    if (!userId) throw new Error('Sign in to register');
    await api.registerForTournament(tournamentId, userId);
    await refresh();
  }, [userId, refresh]);

  const withdraw = useCallback(async (tournamentId: string) => {
    if (!userId) return;
    await api.withdrawFromTournament(tournamentId, userId);
    await refresh();
  }, [userId, refresh]);

  const openBracket = useCallback(async (tournamentId: string) => {
    const view = await api.fetchBracket(tournamentId);
    setActiveBracket(view);
  }, []);

  const clearPendingMatch = useCallback(() => setPendingMatch(null), []);

  return {
    upcoming,
    registrations,
    activeBracket,
    pendingMatch,
    error,
    refresh,
    register,
    withdraw,
    openBracket,
    clearPendingMatch,
  };
}
