import { useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import type { AppMode } from '../appRouteTypes';
import type { TournamentMatchContext } from '../match/session/tournament/tournamentMatchSessionTypes';
import type { useTournament } from '../tournament/useTournament';
import type { SessionSnapshot } from './session/sessionTypes';
import {
  canAttemptMatchAbandon,
  emitMatchAbandonTransport,
  handleMatchAbandonFailure,
  performMatchAbandonSuccessCleanup,
  performPostGameHomeTeardown,
} from './postGameExit';
import { selectJoinedRoomCode } from './session/sessionStateMachine';

export type UseMatchExitHandlersParams = {
  socketRef: React.RefObject<Socket | null>;
  sessionRef: React.RefObject<SessionSnapshot>;
  normalizeRoomCode: (value: unknown) => string;
  currentTournamentContext: TournamentMatchContext | null;
  tournament: ReturnType<typeof useTournament>;
  resetMultiplayerRoomState: (opts?: { keepPlayers?: boolean; clearRoomCode?: boolean }) => void;
  resetRoomRecoveryState: () => void;
  clearRecoverableRoomState: () => void;
  navigateAfterTournamentMatch: (view: 'bracket' | 'result') => void;
  disconnect: (reason?: string) => void;
  showToast: (msg: string, duration?: number) => void;
  shellSetActionError: (msg: string) => void;
  setAppMode: React.Dispatch<React.SetStateAction<AppMode>>;
  setActiveTournamentId: (id: string | null) => void;
  setTournamentSubView: (view: 'hub' | 'bracket' | 'result') => void;
};

export type UseMatchExitHandlersResult = {
  handlePostGame: () => void;
  abandonCurrentMatch: () => Promise<void>;
};

export function useMatchExitHandlers(
  params: UseMatchExitHandlersParams,
): UseMatchExitHandlersResult {
  const {
    socketRef,
    sessionRef,
    normalizeRoomCode,
    currentTournamentContext,
    tournament,
    resetMultiplayerRoomState,
    resetRoomRecoveryState,
    clearRecoverableRoomState,
    navigateAfterTournamentMatch,
    disconnect,
    showToast,
    shellSetActionError,
    setAppMode,
    setActiveTournamentId,
    setTournamentSubView,
  } = params;

  const handlePostGame = useCallback(() => {
    resetRoomRecoveryState();
    if (currentTournamentContext) {
      navigateAfterTournamentMatch('bracket');
      return;
    }
    performPostGameHomeTeardown({ resetMultiplayerRoomState, disconnect });
  }, [
    currentTournamentContext,
    disconnect,
    navigateAfterTournamentMatch,
    resetMultiplayerRoomState,
    resetRoomRecoveryState,
  ]);

  const abandonCurrentMatch = useCallback(async () => {
    const activeSocket = socketRef.current;
    const activeRoomCode = normalizeRoomCode(selectJoinedRoomCode(sessionRef.current));
    if (!canAttemptMatchAbandon({ socket: activeSocket, activeRoomCode })) {
      shellSetActionError('Could not leave the match right now.');
      return;
    }
    console.log('[leave-game] confirm', {
      mode: currentTournamentContext ? 'tournament' : 'multiplayer',
      roomCode: activeRoomCode,
      tournamentMatchId: currentTournamentContext?.matchId ?? null,
    });
    try {
      const resp = await emitMatchAbandonTransport(activeSocket!, {
        roomCode: activeRoomCode,
        tournamentMatchId: currentTournamentContext?.matchId ?? null,
      });
      if (!resp?.ok) {
        const errorMessage = resp?.error ?? 'Could not leave the match.';
        console.log('[leave-game] ack/error', { roomCode: activeRoomCode, error: errorMessage });
        handleMatchAbandonFailure(errorMessage, { shellSetActionError, showToast });
        return;
      }
      console.log('[leave-game] ack/success', { roomCode: activeRoomCode });
      performMatchAbandonSuccessCleanup({
        clearRecoverableRoomState,
        resetMultiplayerRoomState,
        shellSetActionError,
      });
      if (currentTournamentContext?.tournamentId) {
        setActiveTournamentId(currentTournamentContext.tournamentId);
        setTournamentSubView('bracket');
        setAppMode('tournament');
        void tournament.openBracket(currentTournamentContext.tournamentId);
        void tournament.refresh();
      } else {
        setAppMode('multiplayer');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not leave the match.';
      console.log('[leave-game] ack/error', { roomCode: activeRoomCode, error: message });
      handleMatchAbandonFailure(message, { shellSetActionError, showToast });
    }
  }, [
    clearRecoverableRoomState,
    currentTournamentContext,
    normalizeRoomCode,
    resetMultiplayerRoomState,
    showToast,
    tournament,
  ]);

  return { handlePostGame, abandonCurrentMatch };
}
