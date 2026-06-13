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

function sameScheduledTournament(a: ScheduledTournament, b: ScheduledTournament): boolean {
  return (
    a.id === b.id &&
    a.scheduled_start === b.scheduled_start &&
    a.registration_open_at === b.registration_open_at &&
    a.registration_close_at === b.registration_close_at &&
    a.status === b.status &&
    a.format === b.format &&
    a.win_target === b.win_target &&
    a.max_players === b.max_players &&
    a.winner_id === b.winner_id &&
    a.created_at === b.created_at &&
    (a.registered_count ?? null) === (b.registered_count ?? null)
  );
}

function sameScheduledTournamentList(
  prev: ScheduledTournament[],
  next: ScheduledTournament[],
): boolean {
  return (
    prev.length === next.length &&
    prev.every((item, index) => sameScheduledTournament(item, next[index]!))
  );
}

function sameRegistration(a: Registration, b: Registration): boolean {
  return (
    a.id === b.id &&
    a.tournament_id === b.tournament_id &&
    a.user_id === b.user_id &&
    a.registered_at === b.registered_at &&
    a.seed === b.seed &&
    a.placement === b.placement &&
    a.status === b.status &&
    (a.username ?? null) === (b.username ?? null) &&
    (a.rating ?? null) === (b.rating ?? null)
  );
}

function sameRegistrationList(prev: Registration[], next: Registration[]): boolean {
  return prev.length === next.length && prev.every((item, index) => sameRegistration(item, next[index]!));
}

function sameBracketView(prev: BracketView | null, next: BracketView | null): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  if (!sameScheduledTournament(prev.tournament, next.tournament)) return false;
  if (!sameRegistrationList(prev.registrations, next.registrations)) return false;
  if (prev.matches.length !== next.matches.length) return false;
  return prev.matches.every((match, index) => {
    const other = next.matches[index]!;
    return (
      match.id === other.id &&
      match.tournament_id === other.tournament_id &&
      match.round === other.round &&
      match.match_number === other.match_number &&
      match.player1_id === other.player1_id &&
      match.player2_id === other.player2_id &&
      match.winner_id === other.winner_id &&
      match.room_code === other.room_code &&
      match.status === other.status &&
      (match.bot_tier ?? null) === (other.bot_tier ?? null) &&
      match.started_at === other.started_at &&
      match.completed_at === other.completed_at &&
      match.player1_score === other.player1_score &&
      match.player2_score === other.player2_score
    );
  });
}

function sameRecoveryMatch(
  prev: TournamentMeResponse['activeAssignedMatch'],
  next: TournamentMeResponse['activeAssignedMatch'],
): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  return (
    prev.matchId === next.matchId &&
    prev.tournamentId === next.tournamentId &&
    prev.round === next.round &&
    prev.matchNumber === next.matchNumber &&
    prev.roomCode === next.roomCode &&
    prev.opponentId === next.opponentId &&
    prev.opponentUsername === next.opponentUsername &&
    prev.matchStatus === next.matchStatus &&
    prev.readyDeadlineAt === next.readyDeadlineAt
  );
}

function sameAssignedMatch(
  prev: TournamentMeResponse['assignedMatch'],
  next: TournamentMeResponse['assignedMatch'],
): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  return (
    prev.matchId === next.matchId &&
    prev.tournamentId === next.tournamentId &&
    prev.round === next.round &&
    prev.matchNumber === next.matchNumber &&
    prev.opponentId === next.opponentId &&
    prev.opponentUsername === next.opponentUsername &&
    prev.roomCode === next.roomCode &&
    prev.matchStatus === next.matchStatus &&
    prev.scheduledStart === next.scheduledStart &&
    prev.matchStartsAt === next.matchStartsAt &&
    prev.readyDeadlineAt === next.readyDeadlineAt
  );
}

function sameCountdown(
  prev: TournamentMeResponse['countdown'],
  next: TournamentMeResponse['countdown'],
): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  return prev.kind === next.kind && prev.at === next.at;
}

function samePendingMatch(prev: MatchReadyEvent | null, next: MatchReadyEvent | null): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  return (
    prev.tournamentId === next.tournamentId &&
    prev.matchId === next.matchId &&
    prev.round === next.round &&
    prev.matchNumber === next.matchNumber &&
    prev.roomCode === next.roomCode &&
    prev.matchStatus === next.matchStatus &&
    prev.readyAt === next.readyAt &&
    prev.readyDeadlineAt === next.readyDeadlineAt &&
    prev.opponentId === next.opponentId &&
    prev.opponentUsername === next.opponentUsername
  );
}

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

  const applyUpcoming = useCallback((next: ScheduledTournament[]) => {
    setUpcoming((prev) => (sameScheduledTournamentList(prev, next) ? prev : next));
  }, []);

  const applyRegistrations = useCallback((next: Registration[]) => {
    setRegistrations((prev) => (sameRegistrationList(prev, next) ? prev : next));
  }, []);

  const applyActiveBracket = useCallback((next: BracketView | null) => {
    setActiveBracket((prev) => (sameBracketView(prev, next) ? prev : next));
  }, []);

  const applyRecoveryMatch = useCallback((next: TournamentMeResponse['activeAssignedMatch']) => {
    setRecoveryMatch((prev) => (sameRecoveryMatch(prev, next) ? prev : next));
  }, []);

  const applyAssignedMatch = useCallback((next: TournamentMeResponse['assignedMatch']) => {
    setAssignedMatch((prev) => (sameAssignedMatch(prev, next) ? prev : next));
  }, []);

  const applyCountdown = useCallback((next: TournamentMeResponse['countdown']) => {
    setCountdown((prev) => (sameCountdown(prev, next) ? prev : next));
  }, []);

  const fetchAndApplyBracket = useCallback(async (tournamentId: string) => {
    const view = await api.fetchBracket(tournamentId);
    applyActiveBracket(view);
  }, [applyActiveBracket]);

  const refresh = useCallback(async (): Promise<boolean> => {
    const cleanUserId = userId?.trim() || null;
    if (!hasLoaded) {
      setIsLoading(true);
    }
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
      applyUpcoming(u);
      applyRegistrations(me?.registrations ?? []);
      const recovered = me?.activeAssignedMatch ?? null;
      if (recovered && isTerminalTournamentMatch(recovered.matchId)) {
        console.log('[tournament:recovery] ignored completed match', {
          matchId: recovered.matchId,
          roomCode: recovered.roomCode,
        });
        applyRecoveryMatch(null);
      } else {
        if (recovered) {
          console.log('[tournament] recovery activeAssignedMatch received', recovered);
        }
        applyRecoveryMatch(recovered);
      }
      setTournamentPhase((prev) =>
        prev === (me?.currentTournamentPhase ?? null) ? prev : (me?.currentTournamentPhase ?? null),
      );
      setActiveTournamentId((prev) =>
        prev === (me?.activeTournamentId ?? null) ? prev : (me?.activeTournamentId ?? null),
      );
      applyAssignedMatch(me?.assignedMatch ?? null);
      applyCountdown(me?.countdown ?? null);
      setError(null);
      setHasLoaded((prev) => (prev ? prev : true));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tournaments');
      return false;
    } finally {
      if (!hasLoaded) {
        setIsLoading(false);
      }
    }
  }, [
    userId,
    hasLoaded,
    applyUpcoming,
    applyRegistrations,
    applyRecoveryMatch,
    applyAssignedMatch,
    applyCountdown,
  ]);

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
      applyRegistrations([]);
      applyRecoveryMatch(null);
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
    applyRegistrations(me.registrations);
    const recovered = me.activeAssignedMatch;
    if (recovered && isTerminalTournamentMatch(recovered.matchId)) {
      console.log('[tournament:recovery] ignored completed match', {
        matchId: recovered.matchId,
        roomCode: recovered.roomCode,
      });
      applyRecoveryMatch(null);
    } else {
      if (recovered) {
        console.log('[tournament] recovery activeAssignedMatch received', recovered);
      }
      applyRecoveryMatch(recovered);
    }
    setTournamentPhase((prev) => (prev === me.currentTournamentPhase ? prev : me.currentTournamentPhase));
    setActiveTournamentId((prev) => (prev === me.activeTournamentId ? prev : me.activeTournamentId));
    applyAssignedMatch(me.assignedMatch);
    applyCountdown(me.countdown);
    setHasLoaded((prev) => (prev ? prev : true));
  }, [userId, applyRegistrations, applyRecoveryMatch, applyAssignedMatch, applyCountdown]);

  useEffect(() => {
    if (!socket) return;
    const onRegOpen = () => { void refresh(); };
    const onRegUpdated = (payload: { tournamentId: string }) => {
      void refresh();
      void fetchAndApplyBracket(payload.tournamentId).catch(() => undefined);
    };
    const onBracket = (payload: { tournamentId: string }) => {
      void fetchAndApplyBracket(payload.tournamentId).catch(() => undefined);
      void refresh();
    };
    const onMatchUpdated = (payload: { tournamentId: string }) => {
      void fetchAndApplyBracket(payload.tournamentId).catch(() => undefined);
    };
    const onMatchReady = (payload: MatchReadyEvent) => {
      console.log('[tournament] match_ready received', {
        matchId: payload.matchId,
        tournamentId: payload.tournamentId,
        roomCode: payload.roomCode,
        matchStatus: payload.matchStatus,
      });
      setPendingMatch((prev) => (samePendingMatch(prev, payload) ? prev : payload));
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
        void fetchAndApplyBracket(payload.tournamentId).catch(() => undefined);
      }
    };
    const onCompleted = (payload: { tournamentId: string }) => {
      setPendingMatch((prev) => (prev?.tournamentId === payload.tournamentId ? null : prev));
      setRecoveryMatch((prev) => (prev?.tournamentId === payload.tournamentId ? null : prev));
      void refresh();
      void fetchAndApplyBracket(payload.tournamentId).catch(() => undefined);
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
  }, [socket, refresh, activeBracket?.tournament.id, fetchAndApplyBracket]);

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
    await refresh();
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
    await fetchAndApplyBracket(tournamentId);
  }, [fetchAndApplyBracket]);

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
