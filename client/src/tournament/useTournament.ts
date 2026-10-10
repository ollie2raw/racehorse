import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  observeMyTournamentsForAnalytics,
  tournamentKindOf,
  trackFritzCupCreated,
  trackFritzCupCreateFailed,
  trackFritzCupTapped,
  trackLiveEventRegistered,
  trackLiveEventRegistrationFailed,
  trackLiveEventRegisterTapped,
  trackTournamentMatchReady,
} from './tournamentAnalytics';
import * as api from './tournamentApi';
import { TournamentApiError } from './tournamentApi';
import { bindTournamentRecoverySignals } from './recoverySignals';
import { isTerminalTournamentMatch } from './terminalMatches';
import type { TournamentHubSocketDelegates } from './tournamentSocketTypes';
import { estimatedServerNowMs, monotonicNow, msUntil, observeTournamentPush } from './tournamentClock';
import type { FritzLaunchIntent } from './tournamentJoinPolicy';
import { deriveTournamentLegacyView } from './myTournamentState';
import type {
  BracketView,
  MatchReadyEvent,
  MyTournament,
  Registration,
  ScheduledTournament,
  TournamentAssignedPlayable,
  TournamentFeatures,
} from './types';
import { logger } from '../utils/logger';
import { isTournamentsEnabled } from '../config/tournamentsFeature';

type Args = {
  userId: string | null;
  /** Live tournaments switched on (default: the client build flag). Off: no requests. */
  enabled?: boolean;
};

/** Coalescing window for event-driven refreshes (a burst of socket events → one refetch). */
export const TOURNAMENT_REFRESH_COALESCE_MS = 250;
/** After this long with no playable match, a Fritz Cup launch says it is taking longer than usual. */
export const FRITZ_LAUNCH_SLOW_MS = 10_000;

export type FritzLaunchPhase = 'idle' | 'creating' | 'building' | 'slow' | 'failed';
export type FritzLaunchState = {
  phase: FritzLaunchPhase;
  /** The cup being started (known once the create response arrives). */
  tournamentId: string | null;
  startedAtMono: number;
  error: TournamentApiError | null;
};

const IDLE_LAUNCH: FritzLaunchState = { phase: 'idle', tournamentId: null, startedAtMono: 0, error: null };

/** setState that keeps the previous value when the next is structurally equal (no re-render on identical polls). */
function useStableState<T>(initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(initial);
  const set = useCallback((next: T) => {
    setValue((prev) => (prev === next || JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, []);
  return [value, set];
}

function errorCode(err: unknown): string {
  return err instanceof TournamentApiError ? err.code : 'network';
}

/**
 * Tournament client state (Phase 3C).
 *
 * Authority: `/upcoming` (public Live Events + feature flags) and, when signed
 * in, `/my` (the player's tournaments, registrations, the playable assigned
 * match, feature flags). Each is fetched independently; one failing never
 * hides what the other returned. Socket events only trigger a coalesced
 * refetch (plus `match_ready` → `pendingMatch`); nothing here joins a match.
 */
export function useTournament({ userId, enabled = isTournamentsEnabled() }: Args) {
  const cleanUserId = userId?.trim() || null;
  const [upcoming, setUpcoming] = useStableState<ScheduledTournament[]>([]);
  const [features, setFeatures] = useStableState<TournamentFeatures | null>(null);
  const [myTournaments, setMyTournaments] = useStableState<MyTournament[]>([]);
  const [registrations, setRegistrations] = useStableState<Registration[]>([]);
  const [activeAssignedMatch, setActiveAssignedMatch] = useStableState<TournamentAssignedPlayable | null>(null);
  const [pendingMatch, setPendingMatch] = useStableState<MatchReadyEvent | null>(null);
  // When the last match_ready arrived, and when the last answered /my was sent
  // (monotonic): a /my sent after a push supersedes it.
  const [pendingMatchAtMono, setPendingMatchAtMono] = useState(0);
  const [myRequestedAtMono, setMyRequestedAtMono] = useState(0);
  const [activeBracket, setActiveBracket] = useStableState<BracketView | null>(null);
  // A failed bracket load, tagged with the id it belongs to so a stale error
  // never bleeds onto a different tournament's screen.
  const [bracketError, setBracketError] = useState<{ tournamentId: string; code: string } | null>(null);
  const [upcomingError, setUpcomingError] = useState<string | null>(null);
  const [myError, setMyError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [cancelledTournamentIds, setCancelledTournamentIds] = useState<ReadonlySet<string>>(() => new Set());
  const [fritzLaunch, setFritzLaunch] = useState<FritzLaunchState>(IDLE_LAUNCH);
  const fritzLaunchRef = useRef<FritzLaunchState>(IDLE_LAUNCH);
  const [boundaryTick, setBoundaryTick] = useState(0);

  const hubSocketDelegatesRef = useRef<TournamentHubSocketDelegates>({
    onRegistrationOpen: () => undefined,
    onRegistrationUpdated: () => undefined,
    onBracketGenerated: () => undefined,
    onMatchUpdated: () => undefined,
    onMatchReady: () => undefined,
    onMatchCompleted: () => undefined,
    onRoundCompleted: () => undefined,
    onTournamentCompleted: () => undefined,
    onTournamentCancelled: () => undefined,
    onRecover: () => undefined,
  });

  const setLaunch = useCallback((next: FritzLaunchState) => {
    fritzLaunchRef.current = next;
    setFritzLaunch(next);
  }, []);

  // ── fetching ──────────────────────────────────────────────────────────────

  const inFlightRef = useRef<Promise<boolean> | null>(null);
  const rerunRef = useRef(false);

  const fetchAll = useCallback(async (): Promise<boolean> => {
    if (!enabled) {
      setIsLoading(false);
      setHasLoaded(true);
      return true;
    }
    const requestedAtMono = monotonicNow();
    const [up, my] = await Promise.allSettled([
      api.fetchUpcoming(),
      cleanUserId ? api.fetchMy() : Promise.resolve(null),
    ]);
    if (up.status === 'fulfilled') {
      setUpcoming(up.value.tournaments);
      setUpcomingError(null);
    } else {
      setUpcomingError(errorCode(up.reason));
    }
    if (my.status === 'fulfilled') {
      const value = my.value;
      setMyTournaments(value?.tournaments ?? []);
      setRegistrations(value?.registrations ?? []);
      const playable = value?.activeAssignedMatch ?? null;
      if (value) {
        observeMyTournamentsForAnalytics(value.tournaments);
        if (playable?.matchStatus === 'ready') trackTournamentMatchReady(playable, tournamentKindOf(value.tournaments, playable.tournamentId));
      }
      if (playable && isTerminalTournamentMatch(playable.matchId)) {
        logger.operational('tournament:recovery', 'ignored completed match', { matchId: playable.matchId });
        setActiveAssignedMatch(null);
      } else {
        setActiveAssignedMatch(playable);
      }
      setMyError(null);
      if (cleanUserId) setMyRequestedAtMono(requestedAtMono);
    } else {
      setMyError(errorCode(my.reason));
    }
    // Features: /my when signed in and it answered, else /upcoming.
    const fromMy = my.status === 'fulfilled' && my.value ? my.value.features : null;
    const fromUpcoming = up.status === 'fulfilled' ? up.value.features : null;
    const nextFeatures = fromMy ?? fromUpcoming;
    if (nextFeatures) setFeatures(nextFeatures);
    setHasLoaded(true);
    setIsLoading(false);
    return up.status === 'fulfilled' || (my.status === 'fulfilled' && Boolean(cleanUserId));
  }, [enabled, cleanUserId, setUpcoming, setMyTournaments, setRegistrations, setActiveAssignedMatch, setFeatures]);

  /** Refetch now; concurrent calls share one request and a single follow-up. */
  const refresh = useCallback(async (): Promise<boolean> => {
    if (inFlightRef.current) {
      rerunRef.current = true;
      return inFlightRef.current;
    }
    const run = (async () => {
      let ok = await fetchAll();
      while (rerunRef.current) {
        rerunRef.current = false;
        ok = await fetchAll();
      }
      return ok;
    })();
    inFlightRef.current = run;
    try {
      return await run;
    } finally {
      inFlightRef.current = null;
    }
  }, [fetchAll]);

  const coalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Refetch soon, once for any burst of triggers. */
  const scheduleRefresh = useCallback((delayMs: number = TOURNAMENT_REFRESH_COALESCE_MS) => {
    if (coalesceTimerRef.current) return;
    coalesceTimerRef.current = setTimeout(() => {
      coalesceTimerRef.current = null;
      void refresh();
    }, delayMs);
  }, [refresh]);

  useEffect(() => () => {
    if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
  useEffect(() => { void refresh(); }, [refresh]);

  const fetchAndApplyBracket = useCallback(async (tournamentId: string) => {
    try {
      const view = await api.fetchBracket(tournamentId);
      setActiveBracket(view);
      setBracketError((prev) => (prev?.tournamentId === tournamentId ? null : prev));
    } catch (err) {
      // Never rethrow: callers do `void openBracket(id)`; the screen shows the error.
      setBracketError({ tournamentId, code: errorCode(err) });
    }
  }, [setActiveBracket]);

  const bracketTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleBracketRefresh = useCallback((tournamentId: string) => {
    if (bracketTimerRef.current) return;
    bracketTimerRef.current = setTimeout(() => {
      bracketTimerRef.current = null;
      void fetchAndApplyBracket(tournamentId);
    }, TOURNAMENT_REFRESH_COALESCE_MS);
  }, [fetchAndApplyBracket]);

  // ── legacy (/me-shaped) view, for consumers not yet on /my ────────────────

  const legacyView = useMemo(
    // boundaryTick re-derives at the next registration-close / start boundary.
    () => { void boundaryTick; return deriveTournamentLegacyView(myTournaments, activeAssignedMatch, estimatedServerNowMs()); },
    [myTournaments, activeAssignedMatch, boundaryTick],
  );

  useEffect(() => {
    const next = myTournaments
      .flatMap((t) => [t.registration_close_at, t.scheduled_start])
      .map((iso) => msUntil(iso))
      .filter((ms): ms is number => ms !== null && ms > 0)
      .sort((a, b) => a - b)[0];
    if (next === undefined) return;
    const timer = setTimeout(() => setBoundaryTick((n) => n + 1), Math.min(next + 250, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [myTournaments, boundaryTick]);

  // ── Fritz Cup launch ──────────────────────────────────────────────────────

  const startFritzCup = useCallback(async (): Promise<void> => {
    const current = fritzLaunchRef.current.phase;
    if (current === 'creating' || current === 'building') return; // double tap
    trackFritzCupTapped();
    setLaunch({ phase: 'creating', tournamentId: null, startedAtMono: monotonicNow(), error: null });
    try {
      const started = await api.startFritzCup();
      if (!started.existing) trackFritzCupCreated();
      const launch = fritzLaunchRef.current;
      if (launch.phase !== 'creating') return; // ended meanwhile
      setLaunch({ ...launch, phase: 'building', tournamentId: started.tournament.id });
      if (started.activeAssignedMatch) setActiveAssignedMatch(started.activeAssignedMatch);
      scheduleRefresh(0);
    } catch (err) {
      const error = err instanceof TournamentApiError ? err : new TournamentApiError({ code: 'network' });
      trackFritzCupCreateFailed(error.code);
      setLaunch({ ...fritzLaunchRef.current, phase: 'failed', error });
      // A disabled feature: re-read the flags so the card hides.
      if (error.code === 'tournaments_disabled') scheduleRefresh(0);
    }
  }, [scheduleRefresh, setActiveAssignedMatch, setLaunch]);

  /** End the launch (its match was joined, the player left the hub, or dismissed the error). */
  const endFritzLaunch = useCallback(() => {
    if (fritzLaunchRef.current.phase !== 'idle') setLaunch(IDLE_LAUNCH);
  }, [setLaunch]);

  // creating/building → slow after FRITZ_LAUNCH_SLOW_MS without a playable match.
  useEffect(() => {
    if (fritzLaunch.phase !== 'creating' && fritzLaunch.phase !== 'building') return;
    const elapsed = monotonicNow() - fritzLaunch.startedAtMono;
    const timer = setTimeout(() => {
      const launch = fritzLaunchRef.current;
      if (launch.phase === 'creating' || launch.phase === 'building') setLaunch({ ...launch, phase: 'slow' });
    }, Math.max(0, FRITZ_LAUNCH_SLOW_MS - elapsed));
    return () => clearTimeout(timer);
  }, [fritzLaunch.phase, fritzLaunch.startedAtMono, setLaunch]);

  /**
   * The explicit-launch intent the join policy may honour: only while the
   * launch is in flight and younger than FRITZ_LAUNCH_INTENT_MS (the policy
   * checks the age).
   */
  const fritzLaunchIntent: FritzLaunchIntent | null = useMemo(() => {
    if (fritzLaunch.phase !== 'creating' && fritzLaunch.phase !== 'building' && fritzLaunch.phase !== 'slow') return null;
    return { startedAtMono: fritzLaunch.startedAtMono, tournamentId: fritzLaunch.tournamentId };
  }, [fritzLaunch.phase, fritzLaunch.startedAtMono, fritzLaunch.tournamentId]);

  // ── socket events → coalesced refetch ─────────────────────────────────────

  useEffect(() => {
    const bracketId = activeBracket?.tournament.id ?? null;
    const touch = (payload?: { tournamentId?: string; serverNow?: string }) => {
      if (payload?.serverNow) observeTournamentPush(payload.serverNow);
      scheduleRefresh();
      if (payload?.tournamentId && payload.tournamentId === bracketId) scheduleBracketRefresh(bracketId);
    };
    hubSocketDelegatesRef.current = {
      onRegistrationOpen: (payload) => touch(payload),
      onRegistrationUpdated: (payload) => touch(payload),
      onBracketGenerated: (payload) => touch(payload),
      onMatchUpdated: (payload) => touch(payload),
      onRoundCompleted: (payload) => touch(payload),
      onMatchReady: (payload) => {
        logger.operational('tournament', 'match_ready received', {
          matchId: payload.matchId,
          tournamentId: payload.tournamentId,
          matchStatus: payload.matchStatus,
        });
        if (payload.serverNow) observeTournamentPush(payload.serverNow);
        setPendingMatch(payload);
        setPendingMatchAtMono(monotonicNow());
        if (payload.matchStatus === 'ready') trackTournamentMatchReady(payload, tournamentKindOf(myTournaments, payload.tournamentId));
        // /my says whether this player has joined it; nothing joins from here.
        scheduleRefresh();
      },
      onMatchCompleted: (payload) => {
        if (pendingMatch?.matchId === payload.matchId) setPendingMatch(null);
        touch(payload);
      },
      onTournamentCompleted: (payload) => {
        if (pendingMatch?.tournamentId === payload.tournamentId) setPendingMatch(null);
        touch(payload);
      },
      onTournamentCancelled: (payload) => {
        setCancelledTournamentIds((prev) => (prev.has(payload.tournamentId) ? prev : new Set([...prev, payload.tournamentId])));
        if (pendingMatch?.tournamentId === payload.tournamentId) setPendingMatch(null);
        if (fritzLaunchRef.current.tournamentId === payload.tournamentId) setLaunch(IDLE_LAUNCH);
        touch(payload);
      },
      onRecover: () => scheduleRefresh(0),
    };
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;
    return bindTournamentRecoverySignals({
      documentLike: document,
      onRecover: () => scheduleRefresh(0),
    });
  }, [scheduleRefresh]);

  // ── registration ──────────────────────────────────────────────────────────

  /** Register; throws TournamentApiError. State comes from the refetch, not a local row. */
  const register = useCallback(async (tournamentId: string): Promise<{ alreadyRegistered: boolean }> => {
    if (!cleanUserId) throw new TournamentApiError({ code: 'not_authenticated' });
    trackLiveEventRegisterTapped();
    let result: { alreadyRegistered: boolean };
    try {
      result = await api.registerForTournament(tournamentId);
    } catch (err) {
      trackLiveEventRegistrationFailed(err instanceof TournamentApiError ? err.code : 'network');
      throw err;
    }
    if (!result.alreadyRegistered) trackLiveEventRegistered();
    await refresh();
    return result;
  }, [cleanUserId, refresh]);

  /** Withdraw; throws TournamentApiError (e.g. withdraw_closed). Nothing is removed locally first. */
  const withdraw = useCallback(async (tournamentId: string): Promise<void> => {
    if (!cleanUserId) throw new TournamentApiError({ code: 'not_authenticated' });
    await api.withdrawFromTournament(tournamentId);
    await refresh();
  }, [cleanUserId, refresh]);

  const openBracket = useCallback(async (tournamentId: string) => {
    await fetchAndApplyBracket(tournamentId);
  }, [fetchAndApplyBracket]);

  const clearPendingMatch = useCallback(() => setPendingMatch(null), [setPendingMatch]);
  /** Forget the playable match until the next refetch says otherwise. */
  const clearRecoveryMatch = useCallback(() => setActiveAssignedMatch(null), [setActiveAssignedMatch]);

  // Hub-level error only when nothing useful loaded at all.
  const error = upcomingError && (!cleanUserId || myError) ? upcomingError : null;

  return {
    // /upcoming + /my
    upcoming,
    features,
    myTournaments,
    registrations,
    activeAssignedMatch,
    upcomingError,
    myError,
    cancelledTournamentIds,
    // socket
    pendingMatch,
    pendingMatchAtMono,
    myRequestedAtMono,
    // Fritz Cup launch
    fritzLaunch,
    fritzLaunchIntent,
    startFritzCup,
    endFritzLaunch,
    // compatibility (/me-shaped, derived from /my)
    recoveryMatch: activeAssignedMatch,
    tournamentPhase: legacyView.tournamentPhase,
    activeTournamentId: legacyView.activeTournamentId,
    assignedMatch: legacyView.assignedMatch,
    countdown: legacyView.countdown,
    // bracket
    activeBracket,
    bracketError,
    // status
    error,
    isLoading,
    hasLoaded,
    // actions
    refresh,
    recover: refresh,
    scheduleRefresh,
    register,
    withdraw,
    openBracket,
    clearPendingMatch,
    clearRecoveryMatch,
    hubSocketDelegatesRef,
  };
}
