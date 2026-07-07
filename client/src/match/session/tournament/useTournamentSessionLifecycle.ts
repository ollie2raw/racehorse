import { useEffect } from 'react';
import type { AppMode } from '../../../types';
import * as tournamentApi from '../../../tournament/tournamentApi';
import { isTerminalTournamentMatch, markTerminalTournamentMatch } from '../../../tournament/terminalMatches';
import { clearLastRoomCode } from '../../recovery/matchRecovery';
import type { TournamentAttachRuntime } from '../../../multiplayer/runtime/tournamentRuntime';
import type { TournamentSessionState } from './useTournamentSessionState';
import type { TournamentAttachFlow } from './useTournamentAttachFlow';
import type { TournamentHookApi } from './tournamentMatchSessionTypes';
import type { Socket } from 'socket.io-client';

type UseTournamentSessionLifecycleParams = {
  socket: Socket | null;
  appMode: AppMode;
  joinedRoom: string | null;
  liveGameOver: boolean | undefined;
  attachRuntime: TournamentAttachRuntime;
  tournament: TournamentHookApi;
  sessionState: TournamentSessionState;
  attachFlow: TournamentAttachFlow;
};

export function useTournamentSessionLifecycle({
  socket,
  appMode,
  joinedRoom,
  liveGameOver,
  attachRuntime,
  tournament,
  sessionState,
  attachFlow,
}: UseTournamentSessionLifecycleParams) {
  const { preventAutoRejoinRef, reconnectShouldJoinRef, reconnectRoomCodeRef } =
    attachRuntime.reconnectRuntime;

  const {
    tournamentSubView,
    activeTournamentId,
    setActiveTournamentId,
    tournamentMatch,
    setTournamentSubView,
    setTournamentResult,
    setTournamentResultLoading,
    setTournamentResultError,
  } = sessionState;

  const { attemptTournamentAttach } = attachFlow;

  useEffect(() => {
    if (!liveGameOver || !tournamentMatch?.matchId) return;
    preventAutoRejoinRef.current = true;
    reconnectShouldJoinRef.current = false;
    reconnectRoomCodeRef.current = null;
    markTerminalTournamentMatch({
      matchId: tournamentMatch.matchId,
      tournamentId: tournamentMatch.tournamentId,
      roomCode: tournamentMatch.roomCode ?? joinedRoom,
    });
    clearLastRoomCode();
  }, [
    joinedRoom,
    liveGameOver,
    preventAutoRejoinRef,
    reconnectRoomCodeRef,
    reconnectShouldJoinRef,
    tournamentMatch,
  ]);

  useEffect(() => {
    const matchId = tournament.recoveryMatch?.matchId;
    if (!matchId) return;
    if (isTerminalTournamentMatch(matchId)) {
      console.log('[tournament:recovery] ignored completed match', {
        matchId,
        roomCode: tournament.recoveryMatch?.roomCode ?? null,
      });
      tournament.clearRecoveryMatch();
      return;
    }
    if (tournament.tournamentPhase === 'completed' || tournament.tournamentPhase === 'eliminated') {
      tournament.clearRecoveryMatch();
      return;
    }
    if (tournament.tournamentPhase === 'bracket_lobby') return;
    void attemptTournamentAttach(matchId, {
      tournamentId: tournament.recoveryMatch?.tournamentId,
      matchStatus: tournament.recoveryMatch?.matchStatus,
    });
  }, [
    appMode,
    attemptTournamentAttach,
    socket,
    tournament.recoveryMatch?.matchId,
    tournament.recoveryMatch?.matchStatus,
    tournament.recoveryMatch?.tournamentId,
    tournament.tournamentPhase,
    tournament.clearRecoveryMatch,
  ]);

  useEffect(() => {
    const pending = tournament.pendingMatch;
    if (!pending?.matchId) return;
    if (tournament.tournamentPhase === 'bracket_lobby') return;
    console.log('[tournament] match_ready received', {
      matchId: pending.matchId,
      tournamentId: pending.tournamentId,
      roomCode: pending.roomCode,
      source: 'pending_drain',
    });
    setActiveTournamentId(pending.tournamentId);
    void attemptTournamentAttach(pending.matchId, {
      tournamentId: pending.tournamentId,
      matchStatus: pending.matchStatus,
    }).then((started) => {
      if (started) {
        tournament.clearPendingMatch();
      }
    });
  }, [
    attemptTournamentAttach,
    setActiveTournamentId,
    socket,
    tournament.clearPendingMatch,
    tournament.pendingMatch?.matchId,
    tournament.pendingMatch?.matchStatus,
    tournament.pendingMatch?.tournamentId,
    tournament.tournamentPhase,
  ]);

  useEffect(() => {
    if (tournamentSubView === 'result' && activeTournamentId && !tournament.activeBracket) {
      void tournament.openBracket(activeTournamentId);
    }
  }, [activeTournamentId, tournament.activeBracket, tournament.openBracket, tournamentSubView]);

  useEffect(() => {
    if (appMode !== 'tournament') return;
    if (tournamentSubView === 'bracket' && !activeTournamentId) {
      console.log('[app:navigation] invalid state fallback', {
        appMode,
        hash: typeof window !== 'undefined' ? window.location.hash : '',
      });
      setTournamentSubView('hub');
    }
  }, [activeTournamentId, appMode, setTournamentSubView, tournamentSubView]);

  useEffect(() => {
    if (tournamentSubView !== 'result' || !activeTournamentId) {
      setTournamentResult(null);
      setTournamentResultError(null);
      setTournamentResultLoading(false);
      return;
    }
    let cancelled = false;
    setTournamentResultLoading(true);
    setTournamentResultError(null);
    void tournamentApi.fetchResult(activeTournamentId)
      .then((result) => {
        if (cancelled) return;
        setTournamentResult(result);
      })
      .catch((err) => {
        if (cancelled) return;
        setTournamentResultError(err instanceof Error ? err.message : 'Failed to load tournament result');
      })
      .finally(() => {
        if (!cancelled) setTournamentResultLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeTournamentId,
    setTournamentResult,
    setTournamentResultError,
    setTournamentResultLoading,
    tournamentSubView,
  ]);
}