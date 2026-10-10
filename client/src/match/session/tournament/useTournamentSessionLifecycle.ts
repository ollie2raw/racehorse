import { useEffect } from 'react';
import type { AppMode } from '../../../types';
import * as tournamentApi from '../../../tournament/tournamentApi';
import { tournamentErrorCopy } from '../../../tournament/tournamentErrorCopy';
import { isTerminalTournamentMatch, markTerminalTournamentMatch } from '../../../tournament/terminalMatches';
import { clearLastRoomCode } from '../../recovery/matchRecovery';
import type { TournamentAttachRuntime } from '../../../multiplayer/runtime/tournamentRuntime';
import type { TournamentSessionState } from './useTournamentSessionState';
import type { TournamentAttachFlow } from './useTournamentAttachFlow';
import type { TournamentHookApi } from './tournamentMatchSessionTypes';
import type { Socket } from 'socket.io-client';
import { logger } from '../../../utils/logger';
import { decideTournamentAutoAttach, matchEndsFritzLaunchIntent } from '../../../tournament/tournamentJoinPolicy';
import { monotonicNow } from '../../../tournament/tournamentClock';

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

  // Join policy (tournament/tournamentJoinPolicy.ts): a `ready` match is never
  // joined without a tap; an `in_progress` match this player already joined is
  // restored; Play Fritz Cup may join its own cup's first match.
  const inOtherGame = (roomCode: string | null | undefined) =>
    appMode === 'multiplayer' && Boolean(joinedRoom) && joinedRoom !== (roomCode ?? null);

  // The playable match from /my (or the Fritz Cup create response).
  useEffect(() => {
    const match = tournament.activeAssignedMatch;
    if (!match?.matchId) return;
    if (isTerminalTournamentMatch(match.matchId)) {
      logger.operational('tournament:recovery', 'ignored completed match', {
        matchId: match.matchId,
        roomCode: match.roomCode ?? null,
      });
      tournament.clearRecoveryMatch();
      return;
    }
    const decision = decideTournamentAutoAttach({
      source: 'my',
      match,
      launchIntent: tournament.fritzLaunchIntent,
      nowMono: monotonicNow(),
      inOtherGame: inOtherGame(match.roomCode),
    });
    if (!decision.attach) {
      logger.operational('tournament:join-policy', 'not joined automatically', { matchId: match.matchId, reason: decision.reason });
      return;
    }
    setActiveTournamentId(match.tournamentId);
    void attemptTournamentAttach(match.matchId, {
      tournamentId: match.tournamentId,
      matchStatus: match.matchStatus,
    }).then((started) => {
      if (started && decision.reason === 'fritz_launch') tournament.endFritzLaunch();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keys on the specific tournament fields; the object changes every poll
  }, [
    appMode,
    joinedRoom,
    attemptTournamentAttach,
    socket,
    tournament.activeAssignedMatch?.matchId,
    tournament.activeAssignedMatch?.matchStatus,
    tournament.activeAssignedMatch?.tournamentId,
    tournament.fritzLaunchIntent,
    tournament.clearRecoveryMatch,
  ]);

  // A `tournament:match_ready` push: only an explicit Fritz Cup launch may join from it.
  useEffect(() => {
    const pending = tournament.pendingMatch;
    if (!pending?.matchId) return;
    if (matchEndsFritzLaunchIntent(tournament.fritzLaunchIntent, pending.tournamentId)) {
      tournament.endFritzLaunch();
      return;
    }
    const decision = decideTournamentAutoAttach({
      source: 'match_ready',
      match: pending,
      launchIntent: tournament.fritzLaunchIntent,
      nowMono: monotonicNow(),
      inOtherGame: inOtherGame(pending.roomCode),
    });
    if (!decision.attach) {
      logger.operational('tournament:join-policy', 'match_ready not joined automatically', { matchId: pending.matchId, reason: decision.reason });
      return;
    }
    setActiveTournamentId(pending.tournamentId);
    void attemptTournamentAttach(pending.matchId, {
      tournamentId: pending.tournamentId,
      matchStatus: pending.matchStatus,
    }).then((started) => {
      if (started) {
        tournament.clearPendingMatch();
        tournament.endFritzLaunch();
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keys on the specific tournament fields; the object changes every poll
  }, [
    appMode,
    joinedRoom,
    attemptTournamentAttach,
    setActiveTournamentId,
    socket,
    tournament.clearPendingMatch,
    tournament.pendingMatch?.matchId,
    tournament.pendingMatch?.matchStatus,
    tournament.pendingMatch?.tournamentId,
    tournament.fritzLaunchIntent,
  ]);

  // Leaving the tournament screens ends a Fritz Cup launch (joining it switches to the match).
  useEffect(() => {
    if (appMode !== 'tournament' && appMode !== 'multiplayer') tournament.endFritzLaunch();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only on navigation
  }, [appMode]);

  useEffect(() => {
    if (tournamentSubView === 'result' && activeTournamentId && !tournament.activeBracket) {
      void tournament.openBracket(activeTournamentId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keys on the specific tournament fields; the object changes every poll
  }, [activeTournamentId, tournament.activeBracket, tournament.openBracket, tournamentSubView]);

  useEffect(() => {
    if (appMode !== 'tournament') return;
    if (tournamentSubView === 'bracket' && !activeTournamentId) {
      logger.operational('app:navigation', 'invalid state fallback', {
        appMode,
        path: typeof window !== 'undefined' ? window.location.pathname : '',
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
        setTournamentResultError(tournamentErrorCopy(err instanceof Error ? err.message : null));
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
