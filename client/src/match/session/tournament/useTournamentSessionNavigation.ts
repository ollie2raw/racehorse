import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import {
  markTerminalTournamentMatch,
  markTournamentTerminal,
  tournamentSubViewAfterMatchComplete,
} from '../../../tournament/terminalMatches';
import type { TournamentAttachRuntime } from '../../../multiplayer/runtime/tournamentRuntime';
import type { TournamentAttachRefs } from './useTournamentAttachRefs';
import type { TournamentSessionState } from './useTournamentSessionState';
import type { TournamentHookApi, TournamentSubView } from './tournamentMatchSessionTypes';

type UseTournamentSessionNavigationParams = {
  attachRuntime: TournamentAttachRuntime;
  socket: Socket | null;
  joinedRoom: string | null;
  setActionError: Dispatch<SetStateAction<string>>;
  tournament: TournamentHookApi;
  sessionState: TournamentSessionState;
  attachRefs: TournamentAttachRefs;
};

export function useTournamentSessionNavigation({
  attachRuntime,
  socket,
  joinedRoom,
  setActionError,
  tournament,
  sessionState,
  attachRefs,
}: UseTournamentSessionNavigationParams) {
  const { socketRef } = attachRuntime.socketRuntime;
  const { sessionRef } = attachRuntime.sessionRuntime;
  const { clearRecoverableRoomStateRef, resetMultiplayerRoomStateRef } = attachRuntime.recoveryRuntime;
  const { appModeRef, setAppMode } = attachRuntime.navigationRuntime;

  const {
    activeTournamentId,
    setActiveTournamentId,
    setTournamentSubView,
    tournamentMatch,
    markTournamentGameOverConsumed,
    dismissedTournamentIdsRef,
    setTournamentResult,
    setTournamentResultError,
  } = sessionState;

  const {
    pendingTournamentAttachMatchIdRef,
    attachedTournamentMatchIdRef,
    matchFinalizedRef,
  } = attachRefs;

  const currentTournamentContext = tournamentMatch;

  const finalizeTournamentMatchSession = useCallback(
    (input: {
      matchId: string;
      tournamentId: string;
      roomCode?: string | null;
      round?: number;
      routeView?: TournamentSubView;
      tournamentCompleted?: boolean;
    }) => {
      const { matchId, tournamentId, roomCode, round, routeView, tournamentCompleted } = input;
      if (matchFinalizedRef.current.has(matchId)) {
        console.warn('[tournament] already finalized', matchId);
        return;
      }
      matchFinalizedRef.current.add(matchId);
      markTerminalTournamentMatch({ matchId, tournamentId, roomCode });
      markTournamentGameOverConsumed(matchId);
      attachedTournamentMatchIdRef.current = null;
      pendingTournamentAttachMatchIdRef.current = null;
      console.log('[tournament:complete] clearing live room state', {
        roomCode: roomCode ?? sessionRef.current.context.roomCode,
      });
      clearRecoverableRoomStateRef.current();
      const activeSocket = socketRef.current;
      const activeRoom = sessionRef.current.context.roomCode;
      if (activeSocket?.connected && activeRoom) {
        activeSocket.emit('room:leave', activeRoom);
      }
      resetMultiplayerRoomStateRef.current({ keepPlayers: true });
      const nextView =
        routeView ?? tournamentSubViewAfterMatchComplete({ round, tournamentCompleted });
      if (tournamentCompleted || round === 3) {
        markTournamentTerminal({ tournamentId });
      }
      console.log('[tournament:complete] routing to result', {
        tournamentId,
        matchId,
        nextView,
      });
      setActiveTournamentId(tournamentId);
      if (nextView !== 'hub') {
        void tournament.openBracket(tournamentId);
      }
      setTournamentSubView(nextView);
      setAppMode('tournament');
      tournament.clearPendingMatch();
      tournament.clearRecoveryMatch();
      void tournament.refresh();
    },
    [
      attachedTournamentMatchIdRef,
      clearRecoverableRoomStateRef,
      sessionRef,
      matchFinalizedRef,
      markTournamentGameOverConsumed,
      pendingTournamentAttachMatchIdRef,
      resetMultiplayerRoomStateRef,
      setActiveTournamentId,
      setAppMode,
      setTournamentSubView,
      socketRef,
      tournament,
    ],
  );

  const enterTournamentLobby = useCallback(
    (tournamentId: string) => {
      dismissedTournamentIdsRef.current.delete(tournamentId);
      setActiveTournamentId(tournamentId);
      setTournamentSubView('bracket');
      void tournament.openBracket(tournamentId);
    },
    [dismissedTournamentIdsRef, setActiveTournamentId, setTournamentSubView, tournament],
  );

  const exitToTournamentHub = useCallback(
    (reason: string) => {
      const tid = activeTournamentId ?? tournament.activeTournamentId ?? null;
      console.log('[tournament:exit] back-to-tournament clicked', { reason, tournamentId: tid });
      if (tid) {
        dismissedTournamentIdsRef.current.add(tid);
        if (reason !== 'bracket_back') {
          markTournamentTerminal({ tournamentId: tid });
        }
      }
      setActiveTournamentId(null);
      tournament.clearPendingMatch();
      tournament.clearRecoveryMatch();
      attachedTournamentMatchIdRef.current = null;
      pendingTournamentAttachMatchIdRef.current = null;
      clearRecoverableRoomStateRef.current();
      const activeSocket = socketRef.current;
      const activeRoom = sessionRef.current.context.roomCode;
      if (activeSocket?.connected && activeRoom) {
        activeSocket.emit('room:leave', activeRoom);
      }
      resetMultiplayerRoomStateRef.current({ keepPlayers: true });
      setTournamentSubView('hub');
      setAppMode('tournament');
      setTournamentResult(null);
      setTournamentResultError(null);
      if (typeof window !== 'undefined' && window.location.hash !== '#/tournament') {
        window.location.hash = '#/tournament';
      }
      console.log('[tournament:exit] cleared stale tournament state', {
        reason,
        tournamentId: tid,
      });
      void tournament.refresh();
    },
    [
      activeTournamentId,
      attachedTournamentMatchIdRef,
      clearRecoverableRoomStateRef,
      dismissedTournamentIdsRef,
      sessionRef,
      pendingTournamentAttachMatchIdRef,
      resetMultiplayerRoomStateRef,
      setActiveTournamentId,
      setAppMode,
      setTournamentResult,
      setTournamentResultError,
      setTournamentSubView,
      socketRef,
      tournament,
    ],
  );

  const navigateAfterTournamentMatch = useCallback(
    (nextView: TournamentSubView) => {
      if (nextView === 'hub') {
        exitToTournamentHub('postgame_hub');
        return;
      }
      if (currentTournamentContext?.matchId) {
        markTerminalTournamentMatch({
          matchId: currentTournamentContext.matchId,
          tournamentId: currentTournamentContext.tournamentId,
          roomCode: currentTournamentContext.roomCode ?? joinedRoom,
        });
        markTournamentGameOverConsumed(currentTournamentContext.matchId);
        console.log('[tournament:postgame] cleared gameover state', {
          roomCode: currentTournamentContext.roomCode ?? joinedRoom,
          matchId: currentTournamentContext.matchId,
        });
        if (nextView === 'result') {
          console.log('[tournament:postgame] final result clicked', {
            tournamentId: currentTournamentContext.tournamentId,
            matchId: currentTournamentContext.matchId,
          });
        } else {
          console.log('[tournament:postgame] returning to bracket', {
            tournamentId: currentTournamentContext.tournamentId,
            matchId: currentTournamentContext.matchId,
          });
        }
      }
      console.log('[app:navigation] tournament match close/home', {
        fromMode: appModeRef.current,
        toMode: 'tournament',
        hash: typeof window !== 'undefined' ? window.location.hash : '',
        hasRoom: Boolean(joinedRoom),
        hasTournamentContext: Boolean(currentTournamentContext),
        nextView,
      });
      clearRecoverableRoomStateRef.current();
      if (socket && joinedRoom) {
        socket.emit('room:leave', joinedRoom);
      }
      if (currentTournamentContext?.tournamentId) {
        setActiveTournamentId(currentTournamentContext.tournamentId);
        void tournament.openBracket(currentTournamentContext.tournamentId);
      }
      tournament.clearPendingMatch();
      tournament.clearRecoveryMatch();
      resetMultiplayerRoomStateRef.current({ keepPlayers: true });
      setActionError('');
      setTournamentSubView(nextView);
      setAppMode('tournament');
      void tournament.refresh();
    },
    [
      appModeRef,
      clearRecoverableRoomStateRef,
      currentTournamentContext,
      exitToTournamentHub,
      joinedRoom,
      markTournamentGameOverConsumed,
      resetMultiplayerRoomStateRef,
      setActionError,
      setActiveTournamentId,
      setAppMode,
      setTournamentSubView,
      socket,
      tournament,
    ],
  );

  return {
    finalizeTournamentMatchSession,
    enterTournamentLobby,
    exitToTournamentHub,
    navigateAfterTournamentMatch,
  };
}

export type TournamentSessionNavigation = ReturnType<typeof useTournamentSessionNavigation>;