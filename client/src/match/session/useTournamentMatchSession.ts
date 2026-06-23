import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { GameState } from '../../types';
import type { AppMode } from '../../types';
import * as tournamentApi from '../../tournament/tournamentApi';
import type { TournamentResultView } from '../../tournament/types';
import {
  evaluateTournamentAttachGuard,
  localHandCountFromJoinResponse,
} from '../../tournament/tournamentAttachGuard';
import {
  deriveBracketTerminalState,
  isTournamentBracketTerminal,
  msUntilBracketAutoKick,
} from '../../tournament/bracketTerminal';
import {
  isTerminalTournamentMatch,
  markTerminalTournamentMatch,
  markTournamentTerminal,
  readTerminalTournamentMatchIds,
  tournamentSubViewAfterMatchComplete,
} from '../../tournament/terminalMatches';
import { shouldDeferTournamentMatchFinalize } from '../../tournament/tournamentPostgamePolicy';
import { emitTournamentAttachAssignedMatch } from '../../multiplayer/roomTransport';
import { logger } from '../../utils/logger';
import { clearLastRoomCode } from '../recovery/matchRecovery';
import { useTournament } from '../../tournament/useTournament';
import type { TournamentAttachRuntime } from '../../multiplayer/multiplayerRuntime';

export type TournamentMatchContext = {
  tournamentId: string;
  matchId: string;
  round: 1 | 2 | 3;
  matchNumber: number;
  roomCode: string | null;
  stageLabel: 'Quarterfinal' | 'Semifinal' | 'Final';
  isTournament: true;
  opponentUserId: string | null;
  opponentUsername: string | null;
  opponentRating: number | null;
};

export function getTournamentStageLabel(round: 1 | 2 | 3): TournamentMatchContext['stageLabel'] {
  if (round === 3) return 'Final';
  if (round === 2) return 'Semifinal';
  return 'Quarterfinal';
}

type TournamentJoinMatchPayload = Pick<TournamentMatchContext, 'matchId' | 'tournamentId' | 'round'>;

function isTournamentJoinMatchPayload(v: unknown): v is TournamentJoinMatchPayload {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.matchId === 'string' &&
    typeof obj.tournamentId === 'string' &&
    typeof obj.round === 'number' &&
    obj.round >= 1 &&
    obj.round <= 3
  );
}

type TournamentSubView = 'hub' | 'bracket' | 'result';

type TournamentHookApi = ReturnType<typeof useTournament>;

export type UseTournamentMatchSessionParams = {
  socket: Socket | null;
  attachRuntime: TournamentAttachRuntime;
  appMode: AppMode;
  authUserId: string | null;
  multiplayerIdentityUserId: string;
  joinedRoom: string | null;
  liveGameOver: boolean | undefined;
  showToast: (message: string, duration?: number) => void;
  setActionError: Dispatch<SetStateAction<string>>;
  normalizeRoomCode: (code: string | null | undefined) => string;
  tournament: TournamentHookApi;
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

export type TournamentMatchSessionApi = {
  tournamentSubView: TournamentSubView;
  setTournamentSubView: Dispatch<SetStateAction<TournamentSubView>>;
  activeTournamentId: string | null;
  setActiveTournamentId: Dispatch<SetStateAction<string | null>>;
  tournamentMatch: TournamentMatchContext | null;
  setTournamentMatch: Dispatch<SetStateAction<TournamentMatchContext | null>>;
  currentTournamentContext: TournamentMatchContext | null;
  tournamentAttachPhase: 'idle' | 'pending' | 'failed';
  tournamentAttachError: string | null;
  tournamentResult: TournamentResultView | null;
  setTournamentResult: Dispatch<SetStateAction<TournamentResultView | null>>;
  tournamentResultLoading: boolean;
  setTournamentResultLoading: Dispatch<SetStateAction<boolean>>;
  tournamentResultError: string | null;
  setTournamentResultError: Dispatch<SetStateAction<string | null>>;
  pendingTournamentAttachMatchIdRef: MutableRefObject<string | null>;
  attachedTournamentMatchIdRef: MutableRefObject<string | null>;
  consumedTournamentGameOverMatchIds: ReadonlySet<string>;
  clearTournamentAttachRefs: () => void;
  applyTournamentMetadataFromJoin: (
    resp: {
      roomCode?: string;
      tournamentMatch?: Record<string, unknown> | null;
      state?: GameState | null;
    },
    nextState: GameState | null,
  ) => 'continue' | 'terminal_handled';
  attemptTournamentAttach: (
    matchId: string,
    opts?: { manual?: boolean; tournamentId?: string; matchStatus?: string },
  ) => Promise<boolean>;
  attachAssignedTournamentMatch: (matchId: string) => void;
  finalizeTournamentMatchSession: (input: {
    matchId: string;
    tournamentId: string;
    roomCode?: string | null;
    round?: number;
    routeView?: TournamentSubView;
    tournamentCompleted?: boolean;
  }) => void;
  exitToTournamentHub: (reason: string) => void;
  enterTournamentLobby: (tournamentId: string) => void;
  navigateAfterTournamentMatch: (nextView: TournamentSubView) => void;
};

export function useTournamentMatchSession(
  params: UseTournamentMatchSessionParams,
): TournamentMatchSessionApi {
  const {
    socket,
    attachRuntime,
    appMode,
    authUserId,
    multiplayerIdentityUserId,
    joinedRoom,
    liveGameOver,
    showToast,
    setActionError,
    normalizeRoomCode,
    tournament,
    onTournamentMatchAbandoned,
    onPrivateMatchAbandoned,
  } = params;
  const { socketRef, connectRef } = attachRuntime.socketRuntime;
  const { joinedRoomRef, joinedRoomResponseRef } = attachRuntime.roomRuntime;
  const { preventAutoRejoinRef, reconnectShouldJoinRef, reconnectRoomCodeRef } =
    attachRuntime.reconnectRuntime;
  const {
    applyJoinedRoomResponseRef,
    clearRecoverableRoomStateRef,
    resetMultiplayerRoomStateRef,
  } = attachRuntime.recoveryRuntime;
  const { appModeRef, setAppMode } = attachRuntime.navigationRuntime;

  const [tournamentSubView, setTournamentSubView] = useState<TournamentSubView>('hub');
  const [activeTournamentId, setActiveTournamentId] = useState<string | null>(null);
  const [tournamentMatch, setTournamentMatch] = useState<TournamentMatchContext | null>(null);
  const [completedTournamentId, setCompletedTournamentId] = useState<string | null>(null);
  const [consumedTournamentGameOverMatchIds, setConsumedTournamentGameOverMatchIds] = useState<
    ReadonlySet<string>
  >(() => new Set(readTerminalTournamentMatchIds()));

  const markTournamentGameOverConsumed = useCallback((matchId: string) => {
    setConsumedTournamentGameOverMatchIds((prev) => {
      if (prev.has(matchId)) return prev;
      const next = new Set(prev);
      next.add(matchId);
      return next;
    });
  }, []);
  const dismissedTournamentIdsRef = useRef<Set<string>>(new Set());
  const [tournamentResult, setTournamentResult] = useState<TournamentResultView | null>(null);
  const [tournamentResultLoading, setTournamentResultLoading] = useState(false);
  const [tournamentResultError, setTournamentResultError] = useState<string | null>(null);
  const pendingTournamentAttachMatchIdRef = useRef<string | null>(null);
  const attachedTournamentMatchIdRef = useRef<string | null>(null);
  const failedTournamentAttachByMatchIdRef = useRef<Record<string, number>>({});
  const attachInFlightRef = useRef<string | null>(null);
  const matchFinalizedRef = useRef<Set<string>>(new Set());
  const [tournamentAttachPhase, setTournamentAttachPhase] = useState<'idle' | 'pending' | 'failed'>(
    'idle',
  );
  const [tournamentAttachError, setTournamentAttachError] = useState<string | null>(null);

  const currentTournamentContext = tournamentMatch;

  const clearTournamentAttachRefs = useCallback(() => {
    pendingTournamentAttachMatchIdRef.current = null;
    attachedTournamentMatchIdRef.current = null;
  }, []);

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
        roomCode: roomCode ?? joinedRoomRef.current,
      });
      clearRecoverableRoomStateRef.current();
      const activeSocket = socketRef.current;
      const activeRoom = joinedRoomRef.current;
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
    [clearRecoverableRoomStateRef, joinedRoomRef, markTournamentGameOverConsumed, resetMultiplayerRoomStateRef, setAppMode, socketRef, tournament],
  );

  const enterTournamentLobby = useCallback(
    (tournamentId: string) => {
      dismissedTournamentIdsRef.current.delete(tournamentId);
      setActiveTournamentId(tournamentId);
      setTournamentSubView('bracket');
      void tournament.openBracket(tournamentId);
    },
    [tournament],
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
      const activeRoom = joinedRoomRef.current;
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
      clearRecoverableRoomStateRef,
      joinedRoomRef,
      resetMultiplayerRoomStateRef,
      setAppMode,
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
      resetMultiplayerRoomStateRef,
      setActionError,
      setAppMode,
      socket,
      tournament,
    ],
  );

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
      clearRecoverableRoomStateRef,
      connectRef,
      finalizeTournamentMatchSession,
      joinedRoomResponseRef,
      multiplayerIdentityUserId,
      resetMultiplayerRoomStateRef,
      setAppMode,
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

  useEffect(() => {
    if (!socket) return;
    const handler = (payload: { tournamentId?: string }) => {
      if (!payload?.tournamentId) return;
      setCompletedTournamentId(payload.tournamentId);
    };
    socket.on('tournament:completed', handler);
    return () => {
      socket.off('tournament:completed', handler);
    };
  }, [socket]);

  useEffect(() => {
    if (!socket) return;
    const onMatchCompleted = (payload: {
      tournamentId?: string;
      matchId?: string;
      roomCode?: string | null;
      round?: number;
    }) => {
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
    };
    socket.on('tournament:match_completed', onMatchCompleted);
    return () => {
      socket.off('tournament:match_completed', onMatchCompleted);
    };
  }, [appModeRef, finalizeTournamentMatchSession, socket, tournament]);

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
    completedTournamentId,
    resetMultiplayerRoomStateRef,
    clearRecoverableRoomStateRef,
    setAppMode,
    tournament.registrations,
  ]);

  useEffect(() => {
    if (!socket) return;
    const onMatchAbandoned = (payload: {
      roomCode?: string;
      abandonedUserId?: string | null;
      abandonedUsername?: string | null;
      message?: string;
      tournamentId?: string | null;
      isTournament?: boolean;
    }) => {
      const currentUserId = authUserId ?? multiplayerIdentityUserId;
      if (!payload?.roomCode || normalizeRoomCode(payload.roomCode) !== normalizeRoomCode(joinedRoomRef.current)) {
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
        detail: payload.message ?? `${payload.abandonedUsername ?? 'Your opponent'} left the game. You win by forfeit.`,
      });
    };
    socket.on('room:match_abandoned', onMatchAbandoned);
    return () => {
      socket.off('room:match_abandoned', onMatchAbandoned);
    };
  }, [
    authUserId,
    clearRecoverableRoomStateRef,
    joinedRoomRef,
    multiplayerIdentityUserId,
    normalizeRoomCode,
    onPrivateMatchAbandoned,
    onTournamentMatchAbandoned,
    resetMultiplayerRoomStateRef,
    setActionError,
    setAppMode,
    socket,
    tournament,
  ]);

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
    if (appMode !== 'tournament') return;
    const tid = tournament.activeTournamentId;
    const phase = tournament.tournamentPhase;
    if (!tid || !phase) return;
    if (dismissedTournamentIdsRef.current.has(tid)) return;

    const bracket =
      tournament.activeBracket?.tournament.id === tid ? tournament.activeBracket : null;
    const terminal = deriveBracketTerminalState({
      bracket,
      userId: authUserId,
      tournamentPhase: phase,
      assignedMatch:
        tournament.assignedMatch?.tournamentId === tid ? tournament.assignedMatch : null,
    });
    if (isTournamentBracketTerminal(terminal)) {
      if (tournamentSubView === 'bracket') {
        exitToTournamentHub('terminal_guard');
      }
      return;
    }

    if (
      phase === 'registered' ||
      phase === 'bracket_lobby' ||
      phase === 'match_ready' ||
      phase === 'in_match'
    ) {
      setActiveTournamentId(tid);
      if (tournamentSubView === 'hub') {
        if (phase === 'bracket_lobby' || phase === 'registered') {
          console.log('[tournament:hub] tournament lobby detected, routing', { tournamentId: tid, phase });
        }
        setTournamentSubView('bracket');
      }
      if (!tournament.activeBracket || tournament.activeBracket.tournament.id !== tid) {
        void tournament.openBracket(tid);
      }
    }
  }, [
    appMode,
    authUserId,
    exitToTournamentHub,
    tournament.activeBracket,
    tournament.activeTournamentId,
    tournament.assignedMatch,
    tournament.openBracket,
    tournament.tournamentPhase,
    tournamentSubView,
  ]);

  useEffect(() => {
    if (appMode !== 'tournament' || tournamentSubView !== 'bracket' || !activeTournamentId) return;
    const bracket =
      tournament.activeBracket?.tournament.id === activeTournamentId
        ? tournament.activeBracket
        : null;
    if (!bracket) return;

    const scheduleKick = () => {
      const terminal = deriveBracketTerminalState({
        bracket,
        userId: authUserId,
        tournamentPhase: tournament.tournamentPhase,
        assignedMatch:
          tournament.assignedMatch?.tournamentId === activeTournamentId
            ? tournament.assignedMatch
            : null,
      });
      if (!isTournamentBracketTerminal(terminal)) return null;
      if (terminal.shouldAutoKickToHub) return 0;
      return msUntilBracketAutoKick(terminal.completedAtMs);
    };

    const kick = () => {
      const waitMs = scheduleKick();
      if (waitMs == null) return;
      console.log('[tournament:exit] final completed, routing hub', {
        tournamentId: activeTournamentId,
        waitMs,
      });
      exitToTournamentHub('auto_kick');
    };

    const initialWait = scheduleKick();
    if (initialWait == null) return undefined;
    if (initialWait === 0) {
      kick();
      return undefined;
    }
    const timer = window.setTimeout(kick, initialWait);
    const interval = window.setInterval(() => {
      const waitMs = scheduleKick();
      if (waitMs === 0) kick();
    }, 15_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [
    activeTournamentId,
    appMode,
    authUserId,
    exitToTournamentHub,
    tournament.activeBracket,
    tournament.assignedMatch,
    tournament.tournamentPhase,
    tournamentSubView,
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
  }, [activeTournamentId, appMode, tournamentSubView]);

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
  }, [activeTournamentId, tournamentSubView]);

  return {
    tournamentSubView,
    setTournamentSubView,
    activeTournamentId,
    setActiveTournamentId,
    tournamentMatch,
    setTournamentMatch,
    currentTournamentContext: tournamentMatch,
    tournamentAttachPhase,
    tournamentAttachError,
    tournamentResult,
    setTournamentResult,
    tournamentResultLoading,
    setTournamentResultLoading,
    tournamentResultError,
    setTournamentResultError,
    pendingTournamentAttachMatchIdRef,
    attachedTournamentMatchIdRef,
    consumedTournamentGameOverMatchIds,
    clearTournamentAttachRefs,
    applyTournamentMetadataFromJoin,
    attemptTournamentAttach,
    attachAssignedTournamentMatch,
    finalizeTournamentMatchSession,
    exitToTournamentHub,
    enterTournamentLobby,
    navigateAfterTournamentMatch,
  };
}
