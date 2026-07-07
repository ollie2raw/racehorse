import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { isTerminalTournamentMatch } from '../../../tournament/terminalMatches';
import { shouldDeferTournamentMatchFinalize } from '../../../tournament/tournamentPostgamePolicy';
import type { TournamentSessionSocketDelegates } from '../../../tournament/tournamentSocketTypes';
import type { TournamentAttachRuntime } from '../../../multiplayer/runtime/tournamentRuntime';
import type { TournamentAttachRefs } from './useTournamentAttachRefs';
import type { TournamentSessionState } from './useTournamentSessionState';
import type { TournamentSessionNavigation } from './useTournamentSessionNavigation';
import type { TournamentHookApi } from './tournamentMatchSessionTypes';

type UseTournamentSessionSocketsParams = {
  attachRuntime: TournamentAttachRuntime;
  authUserId: string | null;
  multiplayerIdentityUserId: string;
  normalizeRoomCode: (code: string | null | undefined) => string;
  setActionError: Dispatch<SetStateAction<string>>;
  tournament: TournamentHookApi;
  sessionState: TournamentSessionState;
  attachRefs: TournamentAttachRefs;
  navigation: TournamentSessionNavigation;
  onTournamentMatchAbandoned: (notice: {
    context: 'tournament';
    title: string;
    detail: string;
    tournamentId: string;
  }) => void;
  onPrivateMatchAbandoned: (notice: {
    context: 'multiplayer';
    title: string;
    detail: string;
  }) => void;
};

export type UseTournamentSessionSocketsResult = {
  sessionSocketDelegatesRef: MutableRefObject<TournamentSessionSocketDelegates>;
};

export function useTournamentSessionSockets({
  attachRuntime,
  authUserId,
  multiplayerIdentityUserId,
  normalizeRoomCode,
  setActionError,
  tournament,
  sessionState,
  attachRefs,
  navigation,
  onTournamentMatchAbandoned,
  onPrivateMatchAbandoned,
}: UseTournamentSessionSocketsParams): UseTournamentSessionSocketsResult {
  const { sessionRef } = attachRuntime.sessionRuntime;
  const { clearRecoverableRoomStateRef, resetMultiplayerRoomStateRef } = attachRuntime.recoveryRuntime;
  const { appModeRef, setAppMode } = attachRuntime.navigationRuntime;

  const {
    activeTournamentId,
    setActiveTournamentId,
    setTournamentSubView,
    completedTournamentId,
    setCompletedTournamentId,
  } = sessionState;

  const { attachedTournamentMatchIdRef } = attachRefs;
  const { finalizeTournamentMatchSession } = navigation;

  const sessionSocketDelegatesRef = useRef<TournamentSessionSocketDelegates>({
    onTournamentCompleted: () => undefined,
    onMatchCompleted: () => undefined,
    onMatchAbandoned: () => undefined,
  });

  sessionSocketDelegatesRef.current = {
    onTournamentCompleted: (payload) => {
      if (!payload?.tournamentId) return;
      setCompletedTournamentId(payload.tournamentId);
    },
    onMatchCompleted: (payload) => {
      if (!payload?.tournamentId || !payload?.matchId) return;
      if (isTerminalTournamentMatch(payload.matchId)) return;
      if (
        shouldDeferTournamentMatchFinalize({
          appMode: appModeRef.current,
          attachedMatchId: attachedTournamentMatchIdRef.current,
          payloadMatchId: payload.matchId,
        })
      ) {
        console.log('[tournament:complete] deferring finalize until postgame overlay', {
          matchId: payload.matchId,
        });
        void tournament.openBracket(payload.tournamentId);
        void tournament.refresh();
        return;
      }
      finalizeTournamentMatchSession({
        matchId: payload.matchId,
        tournamentId: payload.tournamentId,
        roomCode: payload.roomCode,
        round: payload.round,
        tournamentCompleted: payload.round === 3,
      });
    },
    onMatchAbandoned: (payload) => {
      const currentUserId = authUserId ?? multiplayerIdentityUserId;
      if (
        !payload?.roomCode ||
        normalizeRoomCode(payload.roomCode) !== normalizeRoomCode(sessionRef.current.context.roomCode)
      ) {
        return;
      }
      if (payload.abandonedUserId && payload.abandonedUserId === currentUserId) {
        return;
      }
      console.log('[leave-game] received opponent abandoned', {
        roomCode: payload.roomCode,
        abandonedUserId: payload.abandonedUserId ?? null,
      });
      clearRecoverableRoomStateRef.current();
      resetMultiplayerRoomStateRef.current({ keepPlayers: true });
      setActionError('');
      if (payload.isTournament && payload.tournamentId) {
        setActiveTournamentId(payload.tournamentId);
        setTournamentSubView('bracket');
        setAppMode('tournament');
        void tournament.openBracket(payload.tournamentId);
        void tournament.refresh();
        onTournamentMatchAbandoned({
          context: 'tournament',
          title: 'Opponent left the tournament match',
          detail: `${payload.abandonedUsername ?? 'Your opponent'} left the game. You advance by forfeit.`,
          tournamentId: payload.tournamentId,
        });
        return;
      }
      setAppMode('multiplayer');
      onPrivateMatchAbandoned({
        context: 'multiplayer',
        title: 'Opponent left the game',
        detail:
          payload.message ??
          `${payload.abandonedUsername ?? 'Your opponent'} left the game. You win by forfeit.`,
      });
    },
  };

  useEffect(() => {
    if (!completedTournamentId) return;
    const ours =
      completedTournamentId === activeTournamentId ||
      tournament.registrations.some((r) => r.tournament_id === completedTournamentId);
    if (ours) {
      clearRecoverableRoomStateRef.current();
      resetMultiplayerRoomStateRef.current({ keepPlayers: true });
      setActiveTournamentId(completedTournamentId);
      setTournamentSubView('result');
      setAppMode('tournament');
    }
    setCompletedTournamentId(null);
  }, [
    activeTournamentId,
    clearRecoverableRoomStateRef,
    completedTournamentId,
    resetMultiplayerRoomStateRef,
    setActiveTournamentId,
    setAppMode,
    setCompletedTournamentId,
    setTournamentSubView,
    tournament.registrations,
  ]);

  return { sessionSocketDelegatesRef };
}