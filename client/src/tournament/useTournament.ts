import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import * as api from './tournamentApi';
import { bindTournamentRecoverySignals } from './recoverySignals';
import { isTerminalTournamentMatch } from './terminalMatches';
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
  const [tournamentPhase, setTournamentPhase] = useState<TournamentMeResponse['currentTournamentPhase']>(null);
  const [activeTournamentId, setActiveTournamentId] = useState<string | null>(null);
  const [assignedMatch, setAssignedMatch] = useState<TournamentMeResponse['assignedMatch']>(null);
  const [countdown, setCountdown] = useState<TournamentMeResponse['countdown']>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const boundaryRefreshInFlightRef = useRef(false);

  const refresh = useCallback(async (): Promise<boolean> => {
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
      const recovered = me?.activeAssignedMatch ?? null;
      if (recovered && isTerminalTournamentMatch(recovered.matchId)) {
        console.log('[tournament:recovery] ignored completed match', {
          matchId: recovered.matchId,
          roomCode: recovered.roomCode,
        });
        setRecoveryMatch(null);
      } else {
        if (recovered) {
          console.log('[tournament] recovery activeAssignedMatch received', recovered);
        }
        setRecoveryMatch(recovered);
      }
      setTournamentPhase(me?.currentTournamentPhase ?? null);
      setActiveTournamentId(me?.activeTournamentId ?? null);
      setAssignedMatch(me?.assignedMatch ?? null);
      setCountdown(me?.countdown ?? null);
      setError(null);
      setHasLoaded(true);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tournaments');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!hasLoaded) return;
    if (countdown?.kind !== 'registration_close') return;
    const closeAtMs = Date.parse(countdown.at);
    if (!Number.isFinite(closeAtMs)) return;

    let cancelled = false;
    const runBoundaryRefresh = async () => {
      if (cancelled || Date.now() < closeAtMs) return;
      if (boundaryRefreshInFlightRef.current) return;
      boundaryRefreshInFlightRef.current = true;
      console.log('[tournament:hub] registration close reached, refreshing');
      try {
        const ok = await refresh();
        if (!ok) {
          console.log('[tournament:hub] refresh after countdown failed', { error: 'refresh_failed' });
        }
      } catch (err) {
        console.log('[tournament:hub] refresh after countdown failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        boundaryRefreshInFlightRef.current = false;
      }
    };

    const timeout = window.setTimeout(
      () => { void runBoundaryRefresh(); },
      Math.max(0, closeAtMs - Date.now() + 250),
    );
    const interval = window.setInterval(() => { void runBoundaryRefresh(); }, 5_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [countdown?.kind, countdown?.at, hasLoaded, refresh]);

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
    const recovered = me.activeAssignedMatch;
    if (recovered && isTerminalTournamentMatch(recovered.matchId)) {
      console.log('[tournament:recovery] ignored completed match', {
        matchId: recovered.matchId,
        roomCode: recovered.roomCode,
      });
      setRecoveryMatch(null);
    } else {
      if (recovered) {
        console.log('[tournament] recovery activeAssignedMatch received', recovered);
      }
      setRecoveryMatch(recovered);
    }
    setTournamentPhase(me.currentTournamentPhase);
    setActiveTournamentId(me.activeTournamentId);
    setAssignedMatch(me.assignedMatch);
    setCountdown(me.countdown);
    setHasLoaded(true);
  }, [userId]);

  useEffect(() => {
    if (!socket) return;
    const onRegOpen = () => { void refresh(); };
    const onRegUpdated = () => { void refresh(); };
    const onBracket = (payload: { tournamentId: string }) => {
      void api.fetchBracket(payload.tournamentId).then(setActiveBracket).catch(() => undefined);
      void refresh();
    };
    const onMatchUpdated = (payload: { tournamentId: string }) => {
      void api.fetchBracket(payload.tournamentId).then(setActiveBracket).catch(() => undefined);
    };
    const onMatchReady = (payload: MatchReadyEvent) => {
      console.log('[tournament] match_ready received', {
        matchId: payload.matchId,
        tournamentId: payload.tournamentId,
        roomCode: payload.roomCode,
        matchStatus: payload.matchStatus,
      });
      setPendingMatch(payload);
    };
    const onMatchCompleted = (payload: {
      tournamentId: string;
      matchId: string;
      roomCode?: string | null;
      round?: number;
    }) => {
      console.log('[tournament:complete] received match_completed', {
        roomCode: payload.roomCode ?? null,
        matchId: payload.matchId,
        tournamentId: payload.tournamentId,
      });
      setPendingMatch((prev) => (prev?.matchId === payload.matchId ? null : prev));
      setRecoveryMatch((prev) => (prev?.matchId === payload.matchId ? null : prev));
      void refresh();
      if (activeBracket?.tournament.id === payload.tournamentId) {
        void api.fetchBracket(payload.tournamentId).then(setActiveBracket).catch(() => undefined);
      }
    };
    const onCompleted = (payload: { tournamentId: string }) => {
      setPendingMatch((prev) => (prev?.tournamentId === payload.tournamentId ? null : prev));
      setRecoveryMatch((prev) => (prev?.tournamentId === payload.tournamentId ? null : prev));
      void refresh();
      void api.fetchBracket(payload.tournamentId).then(setActiveBracket).catch(() => undefined);
    };
    socket.on('tournament:registration_open', onRegOpen);
    socket.on('tournament:registration_updated', onRegUpdated);
    socket.on('tournament:bracket_generated', onBracket);
    socket.on('tournament:match_updated', onMatchUpdated);
    socket.on('tournament:match_ready', onMatchReady);
    socket.on('tournament:match_completed', onMatchCompleted);
    socket.on('tournament:completed', onCompleted);
    return () => {
      socket.off('tournament:registration_open', onRegOpen);
      socket.off('tournament:registration_updated', onRegUpdated);
      socket.off('tournament:bracket_generated', onBracket);
      socket.off('tournament:match_updated', onMatchUpdated);
      socket.off('tournament:match_ready', onMatchReady);
      socket.off('tournament:match_completed', onMatchCompleted);
      socket.off('tournament:completed', onCompleted);
    };
  }, [socket, refresh, activeBracket?.tournament.id]);

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
    tournamentPhase,
    activeTournamentId,
    assignedMatch,
    countdown,
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
