import { useCallback, useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import * as api from './tournamentApi';
import { bindTournamentRecoverySignals } from './recoverySignals';
import type {
  BracketView,
  MatchReadyEvent,
  Registration,
  ScheduledTournament,
  TournamentMeResponse,
} from './types';

type Args = { socket: Socket | null; userId: string | null };

export function useTournament({ socket, userId }: Args) {
  const [upcoming, setUpcoming] = useState<ScheduledTournament[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [activeBracket, setActiveBracket] = useState<BracketView | null>(null);
  const [pendingMatch, setPendingMatch] = useState<MatchReadyEvent | null>(null);
  const [recoveryMatch, setRecoveryMatch] = useState<TournamentMeResponse['activeAssignedMatch']>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const cleanUserId = userId?.trim() || null;
    setIsLoading(true);
    try {
      const u = await api.fetchUpcoming();
      const me = !cleanUserId
        ? null
        : await api.fetchMe().catch((err) => {
            console.warn(
              '[tournament] fetchMe failed during refresh',
              err instanceof Error ? err.message : err,
            );
            return null;
          });
      setUpcoming(u);
      setRegistrations(me?.registrations ?? []);
      setRecoveryMatch(me?.activeAssignedMatch ?? null);
      setError(null);
      setHasLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tournaments');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const recover = useCallback(async () => {
    const cleanUserId = userId?.trim() || null;
    if (!cleanUserId) {
      setRegistrations([]);
      setRecoveryMatch(null);
      return;
    }
    const me = await api.fetchMe().catch((err) => {
      console.warn(
        '[tournament] fetchMe failed during recover',
        err instanceof Error ? err.message : err,
      );
      return null;
    });
    if (!me) return;
    setRegistrations(me.registrations);
    setRecoveryMatch(me.activeAssignedMatch);
    setHasLoaded(true);
  }, [userId]);

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

  useEffect(() => {
    if (typeof document === 'undefined') return;
    return bindTournamentRecoverySignals({
      socket,
      documentLike: document,
      onRecover: () => {
        void recover();
      },
    });
  }, [socket, recover]);

  const register = useCallback(async (tournamentId: string) => {
    const cleanUserId = userId?.trim() || null;
    if (!cleanUserId) throw new Error('Sign in to register');
    await api.registerForTournament(tournamentId, cleanUserId);
    setRegistrations((prev) => {
      if (prev.some((reg) => reg.tournament_id === tournamentId && (reg.status === 'registered' || reg.status === 'active'))) {
        return prev;
      }
      return [
        ...prev,
        {
          id: `local-${tournamentId}-${cleanUserId}`,
          tournament_id: tournamentId,
          user_id: cleanUserId,
          registered_at: new Date().toISOString(),
          seed: null,
          placement: null,
          status: 'registered',
        },
      ];
    });
    void refresh();
  }, [userId, refresh]);

  const withdraw = useCallback(async (tournamentId: string) => {
    const cleanUserId = userId?.trim() || null;
    if (!cleanUserId) return;
    await api.withdrawFromTournament(tournamentId, cleanUserId);
    setRegistrations((prev) =>
      prev.filter((reg) => !(reg.tournament_id === tournamentId && reg.user_id === cleanUserId)),
    );
    void refresh();
  }, [userId, refresh]);

  const openBracket = useCallback(async (tournamentId: string) => {
    const view = await api.fetchBracket(tournamentId);
    setActiveBracket(view);
  }, []);

  const clearPendingMatch = useCallback(() => setPendingMatch(null), []);
  const clearRecoveryMatch = useCallback(() => setRecoveryMatch(null), []);

  return {
    upcoming,
    registrations,
    activeBracket,
    pendingMatch,
    recoveryMatch,
    error,
    isLoading,
    hasLoaded,
    refresh,
    recover,
    register,
    withdraw,
    openBracket,
    clearPendingMatch,
    clearRecoveryMatch,
  };
}
