import { useCallback } from 'react';
import type { GameState } from '../../../types';
import {
  evaluateTournamentAttachGuard,
  localHandCountFromJoinResponse,
} from '../../../tournament/tournamentAttachGuard';
import {
  isTerminalTournamentMatch,
  markTerminalTournamentMatch,
  readTerminalTournamentMatchIds,
} from '../../../tournament/terminalMatches';
import { emitTournamentAttachAssignedMatch } from '../../../multiplayer/roomTransport';
import { logger } from '../../../utils/logger';
import { clearLastRoomCode } from '../../recovery/matchRecovery';
import type { TournamentAttachRuntime } from '../../../multiplayer/runtime/tournamentRuntime';
import type { TournamentAttachRefs } from './useTournamentAttachRefs';
import type { TournamentSessionState } from './useTournamentSessionState';
import type { TournamentSessionNavigation } from './useTournamentSessionNavigation';
import {
  getTournamentStageLabel,
  isTournamentJoinMatchPayload,
  type TournamentHookApi,
  type TournamentMatchContext,
} from './tournamentMatchSessionTypes';

type UseTournamentAttachFlowParams = {
  attachRuntime: TournamentAttachRuntime;
  multiplayerIdentityUserId: string;
  showToast: (message: string, duration?: number) => void;
  tournament: TournamentHookApi;
  sessionState: TournamentSessionState;
  attachRefs: TournamentAttachRefs;
  navigation: TournamentSessionNavigation;
};

export function useTournamentAttachFlow({
  attachRuntime,
  multiplayerIdentityUserId,
  showToast,
  tournament,
  sessionState,
  attachRefs,
  navigation,
}: UseTournamentAttachFlowParams) {
  const { socketRef, connectRef } = attachRuntime.socketRuntime;
  const { joinedRoomResponseRef } = attachRuntime.roomRuntime;
  const { preventAutoRejoinRef } = attachRuntime.reconnectRuntime;
  const { applyJoinedRoomResponseRef, clearRecoverableRoomStateRef, resetMultiplayerRoomStateRef } =
    attachRuntime.recoveryRuntime;
  const { appModeRef, setAppMode } = attachRuntime.navigationRuntime;

  const {
    activeTournamentId,
    setActiveTournamentId,
    setTournamentMatch,
    consumedTournamentGameOverMatchIds,
    markTournamentGameOverConsumed,
    setTournamentAttachPhase,
    setTournamentAttachError,
  } = sessionState;

  const {
    pendingTournamentAttachMatchIdRef,
    attachedTournamentMatchIdRef,
    failedTournamentAttachByMatchIdRef,
    attachInFlightRef,
  } = attachRefs;

  const { finalizeTournamentMatchSession } = navigation;

  const applyTournamentMetadataFromJoin = useCallback(
    (
      resp: {
        roomCode?: string;
        tournamentMatch?: Record<string, unknown> | null;
        state?: GameState | null;
      },
      nextState: GameState | null,
    ): 'continue' | 'terminal_handled' => {
      const raw = resp.tournamentMatch;
      if (raw) {
        if (!isTournamentJoinMatchPayload(raw)) {
          logger.error('useTournamentMatchSession.ts', new Error('[tournament] invalid match payload'), { raw });
          setTournamentMatch(null);
          return 'continue';
        }
        const round = raw.round;
        setTournamentMatch({
          ...(raw as Omit<TournamentMatchContext, 'stageLabel' | 'isTournament'>),
          matchNumber:
            typeof (raw as Record<string, unknown>).matchNumber === 'number'
              ? ((raw as Record<string, unknown>).matchNumber as number)
              : 1,
          roomCode:
            typeof (raw as Record<string, unknown>).roomCode === 'string'
              ? ((raw as Record<string, unknown>).roomCode as string)
              : typeof resp.roomCode === 'string'
                ? resp.roomCode
                : null,
          stageLabel: getTournamentStageLabel(round),
          isTournament: true,
        } as TournamentMatchContext);
      } else {
        setTournamentMatch(null);
      }

      const tournamentMeta = raw && isTournamentJoinMatchPayload(raw) ? raw : null;
      const completedMatchId = tournamentMeta?.matchId ?? null;
      if (nextState?.gameOver && completedMatchId && tournamentMeta) {
        const tournamentId = tournamentMeta.tournamentId;
        const rawRecord = raw as Record<string, unknown> | null;
        if (
          isTerminalTournamentMatch(completedMatchId) ||
          consumedTournamentGameOverMatchIds.has(completedMatchId)
        ) {
          if (tournamentId) {
            finalizeTournamentMatchSession({
              matchId: completedMatchId,
              tournamentId,
              roomCode:
                typeof resp.roomCode === 'string'
                  ? resp.roomCode
                  : typeof rawRecord?.roomCode === 'string'
                    ? rawRecord.roomCode
                    : null,
              round: tournamentMeta.round,
            });
          } else {
            clearRecoverableRoomStateRef.current();
            resetMultiplayerRoomStateRef.current({ keepPlayers: true });
            setAppMode('tournament');
          }
          return 'terminal_handled';
        }
        preventAutoRejoinRef.current = true;
        clearLastRoomCode();
      }
      return 'continue';
    },
    [
      clearRecoverableRoomStateRef,
      consumedTournamentGameOverMatchIds,
      finalizeTournamentMatchSession,
      preventAutoRejoinRef,
      resetMultiplayerRoomStateRef,
      setAppMode,
      setTournamentMatch,
    ],
  );

  const attemptTournamentAttach = useCallback(
    async (
      matchId: string,
      opts?: { manual?: boolean; tournamentId?: string; matchStatus?: string },
    ): Promise<boolean> => {
      if (attachInFlightRef.current === matchId) {
        console.warn('[tournament] attach already in flight for', matchId);
        return false;
      }
      if (attachInFlightRef.current !== null) {
        console.warn('[tournament] attach in flight for different match, skipping', matchId);
        return false;
      }
      attachInFlightRef.current = matchId;
      try {
        const socketConnected = Boolean(socketRef.current?.connected);
        const guard = evaluateTournamentAttachGuard({
          matchId,
          socketConnected,
          appMode: appModeRef.current,
          pendingMatchId: pendingTournamentAttachMatchIdRef.current,
          attachedMatchId: attachedTournamentMatchIdRef.current,
          failedAtByMatchId: failedTournamentAttachByMatchIdRef.current,
          terminalMatchIds: readTerminalTournamentMatchIds(),
          manual: opts?.manual,
        });

        if (guard.reason === 'no-match') {
          console.log('[tournament:attach-client] skip/no-match');
          return false;
        }
        if (guard.reason === 'socket-disconnected') {
          console.log('[tournament:attach-client] skip/socket-disconnected', { matchId });
          if (!opts?.manual) {
            connectRef.current();
          }
          return false;
        }
        if (guard.reason === 'already-pending') {
          console.log('[tournament:attach-client] skip/already-pending', { matchId });
          return false;
        }
        if (guard.reason === 'already-attached') {
          console.log('[tournament:attach-client] skip/already-attached', {
            matchId,
            appMode: appModeRef.current,
          });
          return false;
        }
        if (guard.reason === 'backoff') {
          console.log('[tournament:attach-client] skip/backoff', { matchId });
          return false;
        }
        if (guard.reason === 'match-completed') {
          console.log('[tournament:recovery] ignored completed match', { matchId });
          tournament.clearRecoveryMatch();
          return false;
        }

        pendingTournamentAttachMatchIdRef.current = matchId;
        setTournamentAttachPhase('pending');
        setTournamentAttachError(null);

        console.log('[tournament:attach-client] start', {
          matchId,
          tournamentId: opts?.tournamentId ?? null,
          status: opts?.matchStatus ?? null,
          socketId: socketRef.current?.id ?? null,
        });

        try {
          const activeSocket = socketRef.current;
          if (!activeSocket?.connected) {
            throw new Error('socket_not_connected');
          }

          const resp = await emitTournamentAttachAssignedMatch(activeSocket, { matchId });

          pendingTournamentAttachMatchIdRef.current = null;

          if (resp?.ok) {
            const handCount = localHandCountFromJoinResponse({
              you: resp.you,
              state: resp.state as { players?: Record<string, { hand?: unknown[] }> },
            });
            const roster = Array.isArray(resp.players) ? resp.players : [];
            const localPlayerId = typeof resp.you === 'string' ? resp.you : '';
            console.log('[tournament:attach-client] ack/success', {
              matchId,
              roomCode: resp.roomCode,
              matchStatus: resp.matchStatus ?? opts?.matchStatus ?? null,
              hasRoom: Boolean(resp.roomCode),
              hasPlayers: roster.length > 0,
              localPlayerId,
              handCount,
            });
            attachedTournamentMatchIdRef.current = matchId;
            const nextFailed = { ...failedTournamentAttachByMatchIdRef.current };
            delete nextFailed[matchId];
            failedTournamentAttachByMatchIdRef.current = nextFailed;
            if (typeof resp.tournamentId === 'string') {
              setActiveTournamentId(resp.tournamentId);
            } else if (opts?.tournamentId) {
              setActiveTournamentId(opts.tournamentId);
            }
            console.log('[tournament:attach-client] applying join response', {
              roomCode: resp.roomCode,
              handCount,
            });
            applyJoinedRoomResponseRef.current(resp);
            const joinedResp = joinedRoomResponseRef.current as {
              state?: GameState | null;
              you?: string;
            } | null;
            const hydratedState = joinedResp?.state ?? resp.state;
            const hydratedYou =
              typeof joinedResp?.you === 'string' ? joinedResp.you : localPlayerId;
            const hydratedHandCount = localHandCountFromJoinResponse({
              you: hydratedYou,
              state: hydratedState as { players?: Record<string, { hand?: unknown[] }> },
            });
            const playerIds = (hydratedState as { playerIds?: string[] } | null | undefined)?.playerIds;
            console.log('[tournament:hydrate-check]', {
              roomCode: resp.roomCode,
              localUserId: multiplayerIdentityUserId,
              localPlayerSeat: hydratedYou,
              player1Id: playerIds?.[0] ?? null,
              player2Id: playerIds?.[1] ?? null,
              handCount: hydratedHandCount,
              boneyardCount:
                (hydratedState as { boneyard?: unknown[] } | null | undefined)?.boneyard?.length ?? null,
              currentTurnPlayerId:
                typeof (hydratedState as { currentPlayerIndex?: number } | null)?.currentPlayerIndex ===
                  'number' && playerIds
                  ? playerIds[(hydratedState as { currentPlayerIndex: number }).currentPlayerIndex] ?? null
                  : null,
              appMode: appModeRef.current,
            });
            const hydratedGameOver = Boolean(
              (hydratedState as { gameOver?: boolean } | null | undefined)?.gameOver,
            );
            if (hydratedGameOver && typeof resp.tournamentId === 'string') {
              finalizeTournamentMatchSession({
                matchId,
                tournamentId: resp.tournamentId,
                roomCode: resp.roomCode ?? null,
                round:
                  resp.tournamentMatch && typeof (resp.tournamentMatch as { round?: number }).round === 'number'
                    ? (resp.tournamentMatch as { round: number }).round
                    : undefined,
              });
              setTournamentAttachPhase('idle');
              setTournamentAttachError(null);
              return true;
            }
            console.log('[tournament:attach-client] switching-to-multiplayer', {
              matchId,
              roomCode: resp.roomCode,
            });
            setAppMode('multiplayer');
            setTournamentAttachPhase('idle');
            setTournamentAttachError(null);
            tournament.clearPendingMatch();
            tournament.clearRecoveryMatch();
            void tournament.recover();
            return true;
          }

          const errorMessage = resp?.error ?? 'Could not join tournament match.';
          failedTournamentAttachByMatchIdRef.current = {
            ...failedTournamentAttachByMatchIdRef.current,
            [matchId]: Date.now(),
          };
          setTournamentAttachPhase('failed');
          setTournamentAttachError(errorMessage);
          console.log('[tournament:attach-client] ack/error', { matchId, error: errorMessage });
          if (errorMessage === 'match_completed') {
            const tournamentId = opts?.tournamentId ?? activeTournamentId ?? null;
            if (tournamentId) {
              markTerminalTournamentMatch({ matchId, tournamentId, roomCode: null });
              markTournamentGameOverConsumed(matchId);
              finalizeTournamentMatchSession({
                matchId,
                tournamentId,
                tournamentCompleted: tournament.tournamentPhase === 'completed',
              });
            } else {
              tournament.clearPendingMatch();
              tournament.clearRecoveryMatch();
              clearRecoverableRoomStateRef.current();
              resetMultiplayerRoomStateRef.current({ keepPlayers: true });
              setAppMode('tournament');
              void tournament.recover();
            }
          } else if (
            errorMessage === 'match_not_ready' ||
            errorMessage === 'tournament_not_assigned' ||
            errorMessage === 'room_unavailable' ||
            errorMessage === 'invalid_room'
          ) {
            tournament.clearPendingMatch();
            tournament.clearRecoveryMatch();
            void tournament.recover();
          }
          showToast(errorMessage, 2500);
          return false;
        } catch (err) {
          pendingTournamentAttachMatchIdRef.current = null;
          const message = err instanceof Error ? err.message : String(err);
          const isTimeout = message.includes('timed out');
          failedTournamentAttachByMatchIdRef.current = {
            ...failedTournamentAttachByMatchIdRef.current,
            [matchId]: Date.now(),
          };
          setTournamentAttachPhase('failed');
          setTournamentAttachError(isTimeout ? 'Join timed out. Try again.' : message);
          if (isTimeout) {
            console.log('[tournament:attach-client] ack/timeout', { matchId });
          } else {
            console.log('[tournament:attach-client] ack/error', { matchId, error: message });
          }
          showToast(isTimeout ? 'Join timed out. Try again.' : message, 2500);
          return false;
        }
      } finally {
        attachInFlightRef.current = null;
      }
    },
    [
      activeTournamentId,
      appModeRef,
      applyJoinedRoomResponseRef,
      attachInFlightRef,
      attachedTournamentMatchIdRef,
      clearRecoverableRoomStateRef,
      connectRef,
      failedTournamentAttachByMatchIdRef,
      finalizeTournamentMatchSession,
      joinedRoomResponseRef,
      markTournamentGameOverConsumed,
      multiplayerIdentityUserId,
      pendingTournamentAttachMatchIdRef,
      resetMultiplayerRoomStateRef,
      setActiveTournamentId,
      setAppMode,
      setTournamentAttachError,
      setTournamentAttachPhase,
      showToast,
      socketRef,
      tournament,
    ],
  );

  const attachAssignedTournamentMatch = useCallback(
    (matchId: string) => {
      void attemptTournamentAttach(matchId, { manual: true });
    },
    [attemptTournamentAttach],
  );

  return {
    applyTournamentMetadataFromJoin,
    attemptTournamentAttach,
    attachAssignedTournamentMatch,
  };
}

export type TournamentAttachFlow = ReturnType<typeof useTournamentAttachFlow>;