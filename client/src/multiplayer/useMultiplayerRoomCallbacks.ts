import { useCallback, useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { GameState, Move, Tile } from '../types';
import type { AppMode } from '../appRouteTypes';
import type { RecoveryEvent } from './recoveryMachine';
import type { RoomEventMeta, RoomPlayer } from './protocol';
import { normalizeRoomPlayers } from './protocol';
import {
  beginRoomOperation,
  invalidateRoomOperations,
  isCurrentRoomOperation,
} from './roomOperationEpoch';
import { clearLastRoomCode } from '../match/recovery/matchRecovery';
import {
  emitRoomCreate,
  emitWithAck,
  type PrivateRoomCreateSettings,
  type RoomAckResponse,
} from './roomTransport';
import {
  selectCanSendReady,
  selectJoinedRoomCode,
  selectMatchStarted,
} from './session/sessionStateMachine';
import {
  dispatchSocketEvent,
  registerNormalizedSocketRouter,
} from './socketEventBus';
import {
  canAttemptMatchmakingRoomJoin,
  emitMatchmakingRoomJoin,
  handleMatchmakingRoomJoinAck,
} from './matchmakingRoomJoin';
import { useJoinAckCoordinator } from './useJoinAckCoordinator';
import type { JoinAckSnapshotResult } from './joinAckCoordinator';
import { logger } from '../utils/logger';
import type { MatchFoundPayload } from '../matchmaking/types';
import type { SessionEvent, SessionSnapshot } from './session/sessionTypes';
import type { MultiplayerShellDelegates } from './multiplayerGameShellTypes';

// ─── Params ──────────────────────────────────────────────────

export type UseMultiplayerRoomCallbacksParams = {
  // Refs
  pendingCreateResolversRef: MutableRefObject<Array<(code: string | null) => void>>;
  maxSequenceRef: MutableRefObject<number>;
  maxEventSequenceRef: MutableRefObject<number>;
  roomMatchIdRef: MutableRefObject<string | null>;
  roomOperationEpochRef: MutableRefObject<number>;
  resyncBufferedUpdateRef: MutableRefObject<import('./protocol').StateUpdatePayload | null>;
  shellDelegatesRef: MutableRefObject<MultiplayerShellDelegates | null>;
  autoJoinAttemptedRef: MutableRefObject<boolean>;
  appModeRef: MutableRefObject<AppMode>;
  joinedRoomResponseRef: MutableRefObject<RoomAckResponse | null>;
  roomPlayersRef: MutableRefObject<RoomPlayer[]>;
  roomIdentityRef: MutableRefObject<{ username: string; userId: string | null; authToken: string | null } | null>;
  youRef: MutableRefObject<string>;
  socketRef: MutableRefObject<Socket | null>;
  sessionRef: MutableRefObject<SessionSnapshot>;
  // Ref write-backs (4 refs that need every-render assignment)
  applyRoomEventMetaRef: MutableRefObject<(meta?: RoomEventMeta | null) => void>;
  schedulePlayerReadyRef: MutableRefObject<() => Promise<void>>;
  applyJoinedRoomResponseRef: MutableRefObject<(resp: RoomAckResponse) => void>;
  trySchedulePlayerReadyRef: MutableRefObject<() => void>;
  // Dispatch / session
  dispatchSession: (event: SessionEvent) => void;
  dispatchRecovery: (event: RecoveryEvent) => void;
  // State setters
  setJoinedRoom: (roomCode: string | null) => void;
  setRoomCode: (code: string) => void;
  setYou: (you: string) => void;
  setPlayers: Dispatch<SetStateAction<RoomPlayer[]>>;
  setTournamentMatch: (match: unknown) => void;
  setError: (error: string) => void;
  setOverlayPayload: (payload: MatchFoundPayload | null) => void;
  setAppMode: (mode: AppMode) => void;
  showToast: (msg: string, duration?: number) => void;
  // Shell setters (from useMultiplayerShellDelegates)
  shellSetState: (value: SetStateAction<GameState | null>) => void;
  shellSetLegalMoves: (value: SetStateAction<Move[]>) => void;
  shellSetCanDraw: (value: SetStateAction<boolean>) => void;
  shellSetSelectedTile: (value: SetStateAction<Tile | null>) => void;
  shellSetHandReveal: (value: SetStateAction<unknown>) => void;
  shellSetRematchRequested: (value: SetStateAction<boolean>) => void;
  shellSetRematchReadyIds: (value: SetStateAction<string[]>) => void;
  shellSetActionError: (value: SetStateAction<string>) => void;
  // Auth
  authProfile: { username: string } | null;
  authUser: { email?: string | null } | null;
  multiplayerIdentityUserId: string | null;
  multiplayerAuthToken: string | null;
  // Utilities
  normalizeRoomCode: (value: unknown) => string;
  // Tournament
  clearTournamentAttachRefs: () => void;
  applyTournamentMetadataFromJoin: (
    resp: RoomAckResponse,
    nextState: GameState | null,
  ) => 'terminal_handled' | void;
  tournament: {
    clearPendingMatch: () => void;
    clearRecoveryMatch: () => void;
  };
};

// ─── Result ──────────────────────────────────────────────────

export type UseMultiplayerRoomCallbacksResult = {
  getInviteLink: (code: string) => string;
  resolvePendingCreate: (code: string | null) => void;
  resetClientGameSession: () => void;
  resetMultiplayerRoomState: (options?: { keepPlayers?: boolean; clearRoomCode?: boolean }) => void;
  clearRecoverableRoomState: () => void;
  applyRoomEventMeta: (meta?: RoomEventMeta | null) => void;
  emitCreateRoom: (targetSocket: Socket, settings?: PrivateRoomCreateSettings) => Promise<RoomAckResponse>;
  trySchedulePlayerReady: () => void;
  schedulePlayerReady: () => Promise<void>;
  applyJoinedRoomResponse: (resp: RoomAckResponse) => void;
  handleJoinAck: (resp: RoomAckResponse) => void;
  handleMatchmakingAutoJoin: (payload: MatchFoundPayload) => void;
};

// ─── Hook ────────────────────────────────────────────────────

export function useMultiplayerRoomCallbacks(
  params: UseMultiplayerRoomCallbacksParams,
): UseMultiplayerRoomCallbacksResult {
  const {
    pendingCreateResolversRef,
    maxSequenceRef,
    maxEventSequenceRef,
    roomMatchIdRef,
    roomOperationEpochRef,
    resyncBufferedUpdateRef,
    shellDelegatesRef,
    autoJoinAttemptedRef,
    appModeRef,
    joinedRoomResponseRef,
    roomPlayersRef,
    roomIdentityRef,
    youRef,
    socketRef,
    sessionRef,
    applyRoomEventMetaRef,
    schedulePlayerReadyRef,
    applyJoinedRoomResponseRef,
    trySchedulePlayerReadyRef,
    dispatchSession,
    dispatchRecovery,
    setJoinedRoom,
    setRoomCode,
    setYou,
    setPlayers,
    setTournamentMatch,
    setError,
    setOverlayPayload,
    setAppMode,
    showToast,
    shellSetState,
    shellSetLegalMoves,
    shellSetCanDraw,
    shellSetSelectedTile,
    shellSetHandReveal,
    shellSetRematchRequested,
    shellSetRematchReadyIds,
    shellSetActionError,
    authProfile,
    authUser,
    multiplayerIdentityUserId,
    multiplayerAuthToken,
    normalizeRoomCode,
    clearTournamentAttachRefs,
    applyTournamentMetadataFromJoin,
    tournament,
  } = params;

  const getInviteLink = useCallback((code: string) => {
    if (typeof window === 'undefined') return '';
    const url = new URL(window.location.href);
    url.searchParams.set('room', code);
    return url.toString();
  }, []);

  const resolvePendingCreate = useCallback((code: string | null) => {
    const pending = pendingCreateResolversRef.current.splice(0);
    pending.forEach((resolve) => resolve(code));
  }, [pendingCreateResolversRef]);

  const resetClientGameSession = useCallback(() => {
    maxSequenceRef.current = -1;
    maxEventSequenceRef.current = -1;
    roomMatchIdRef.current = null;
    dispatchSession({ type: 'SESSION_RESET_GAME' });
    clearTournamentAttachRefs();
    resyncBufferedUpdateRef.current = null;
    shellDelegatesRef.current?.resetShellClientGameSession();
  }, [clearTournamentAttachRefs, dispatchSession, maxSequenceRef, maxEventSequenceRef, roomMatchIdRef, resyncBufferedUpdateRef, shellDelegatesRef]);

  type RoomIdentityResetPart = 'joined' | 'identity' | 'players';
  type GameShellResetPart = 'ui' | 'session';

  const resetRoomIdentityState = useCallback(
    (options: { keepPlayers?: boolean; clearRoomCode?: boolean } = {}, part: RoomIdentityResetPart) => {
      const { keepPlayers = false, clearRoomCode = true } = options;
      if (part === 'joined') { setJoinedRoom(null); return; }
      if (part === 'identity') { roomIdentityRef.current = null; if (clearRoomCode) setRoomCode(''); return; }
      if (!keepPlayers) { setPlayers([]); }
    },
    [setJoinedRoom, setRoomCode, setPlayers, roomIdentityRef],
  );

  const resetGameShellState = useCallback(
    (part: GameShellResetPart) => {
      if (part === 'ui') {
        shellSetState(null);
        shellSetLegalMoves([]);
        shellSetCanDraw(false);
        shellSetSelectedTile(null);
        shellSetHandReveal(null);
        shellSetRematchRequested(false);
        shellSetRematchReadyIds([]);
        return;
      }
      resetClientGameSession();
    },
    [resetClientGameSession, shellSetCanDraw, shellSetHandReveal, shellSetLegalMoves, shellSetRematchReadyIds, shellSetRematchRequested, shellSetSelectedTile, shellSetState],
  );

  const resetTournamentAttachState = useCallback(() => {
    setTournamentMatch(null);
  }, [setTournamentMatch]);

  const resetMultiplayerRoomState = useCallback(
    (options: { keepPlayers?: boolean; clearRoomCode?: boolean } = {}) => {
      invalidateRoomOperations(roomOperationEpochRef);
      resetRoomIdentityState(options, 'joined');
      resetTournamentAttachState();
      resetRoomIdentityState(options, 'identity');
      resetGameShellState('ui');
      resetRoomIdentityState(options, 'players');
      resetGameShellState('session');
    },
    [resetGameShellState, resetRoomIdentityState, resetTournamentAttachState, roomOperationEpochRef],
  );

  const resetRoomRecoveryState = useCallback(() => {
    dispatchRecovery({ type: 'SET_POLICY', policy: 'disabled' });
    dispatchRecovery({ type: 'SET_TARGET_ROOM', roomCode: null });
  }, [dispatchRecovery]);

  const clearRecoverableRoomState = useCallback(() => {
    invalidateRoomOperations(roomOperationEpochRef);
    resetRoomRecoveryState();
    clearLastRoomCode();
    tournament.clearPendingMatch();
    tournament.clearRecoveryMatch();
  }, [resetRoomRecoveryState, tournament, roomOperationEpochRef]);

  const applyRoomEventMeta = useCallback((meta?: RoomEventMeta | null) => {
    if (!meta) return;
    const incomingMatchId = typeof meta.matchId === 'string' ? meta.matchId : null;
    if (incomingMatchId && roomMatchIdRef.current && roomMatchIdRef.current !== incomingMatchId) {
      maxSequenceRef.current = -1;
      maxEventSequenceRef.current = -1;
    }
    if (incomingMatchId) { roomMatchIdRef.current = incomingMatchId; }
    if (typeof meta.lastEventSequence === 'number') {
      maxEventSequenceRef.current = Math.max(maxEventSequenceRef.current, meta.lastEventSequence);
    }
  }, [roomMatchIdRef, maxSequenceRef, maxEventSequenceRef]);

  const emitCreateRoom = useCallback(
    async (targetSocket: Socket, settings?: PrivateRoomCreateSettings) => {
      setError('');
      shellSetActionError('');
      try {
        const operationToken = beginRoomOperation(roomOperationEpochRef);
        const username = authProfile?.username ?? 'Guest';
        const userId = multiplayerIdentityUserId;
        const authToken = multiplayerAuthToken;
        const resp = await emitRoomCreate(targetSocket, { username, userId, authToken, tilesPerPlayer: settings?.dealFormat ?? 7, winningScore: settings?.winTarget ?? 60 });
        if (!resp?.ok) { throw new Error(resp?.error ?? 'Unable to create room.'); }
        if (!isCurrentRoomOperation(roomOperationEpochRef, operationToken)) { return resp; }
        applyJoinedRoomResponseRef.current(resp);
        autoJoinAttemptedRef.current = false;
        dispatchRecovery({ type: 'SET_POLICY', policy: 'auto' });
        resolvePendingCreate(resp.roomCode ?? null);
        return resp;
      } catch (e) {
        resolvePendingCreate(null);
        throw e;
      }
    },
    [authProfile?.username, multiplayerIdentityUserId, multiplayerAuthToken, resolvePendingCreate, dispatchRecovery, shellSetActionError, setError, roomOperationEpochRef, applyJoinedRoomResponseRef, autoJoinAttemptedRef],
  );

  const trySchedulePlayerReady = useCallback(() => {
    if (!selectCanSendReady(sessionRef.current)) { return; }
    const isQuickMatch = appModeRef.current === 'multiplayer' && Boolean(joinedRoomResponseRef.current?.matchmakingMatchId);
    if (isQuickMatch && roomPlayersRef.current.length < 2) { return; }
    void schedulePlayerReadyRef.current();
  }, [sessionRef, appModeRef, joinedRoomResponseRef, roomPlayersRef, schedulePlayerReadyRef]);

  const schedulePlayerReady = useCallback(async () => {
    const session = sessionRef.current;
    if (!selectCanSendReady(session)) return;
    const activeSocket = socketRef.current;
    const roomCode = normalizeRoomCode(selectJoinedRoomCode(session));
    if (!activeSocket?.connected || !roomCode || selectMatchStarted(session)) { return; }
    dispatchSession({ type: 'PLAYER_READY_EMITTED' });
    try {
      const ack = await emitWithAck<RoomAckResponse>(activeSocket, 'player:ready', roomCode);
      if (ack?.ok === false) { dispatchSession({ type: 'ROOM_REQUEST_READY' }); return; }
      dispatchSession({ type: 'PLAYER_READY_ACK', matchStarted: ack?.started === true });
    } catch (error) {
      dispatchSession({ type: 'ROOM_REQUEST_READY' });
      logger.error('App.tsx', new Error('[mp] player:ready failed'), { detail: error instanceof Error ? error.message : error });
    }
  }, [dispatchSession, normalizeRoomCode, sessionRef, socketRef]);

  const applySnapshot = useCallback(
    (resp: RoomAckResponse): JoinAckSnapshotResult =>
      shellDelegatesRef.current?.applyJoinResponseGameState(resp) ?? { ok: false, nextState: null },
    [shellDelegatesRef],
  );

  const { handleJoinAck } = useJoinAckCoordinator({
    dispatchRecovery,
    normalizeRoomCode,
    applySnapshot,
    applyRoomEventMeta,
    setJoinedRoom,
    setRoomCode,
    setYou,
    setPlayers,
    normalizeRoomPlayers,
    sessionRef,
    dispatchSession,
    joinedRoomResponseRef,
    youRef,
    roomPlayersRef,
    roomIdentityRef,
    authProfileUsername: authProfile?.username,
    multiplayerIdentityUserId,
    multiplayerAuthToken,
    onTerminalJoinHandled: (resp, nextState) =>
      applyTournamentMetadataFromJoin(resp, nextState) === 'terminal_handled' ? 'terminal_handled' : undefined,
    trySchedulePlayerReady,
  });

  const applyJoinedRoomResponse = useCallback((resp: RoomAckResponse) => {
    dispatchSocketEvent({ type: 'ROOM_JOIN_OK', payload: resp });
  }, []);

  // Register socket router for room join ack
  useEffect(() => {
    return registerNormalizedSocketRouter({ roomJoinOk: handleJoinAck });
  }, [handleJoinAck]);

  // Ref write-backs: run every render so refs always hold the latest callbacks
  applyRoomEventMetaRef.current = applyRoomEventMeta;
  schedulePlayerReadyRef.current = schedulePlayerReady;
  applyJoinedRoomResponseRef.current = applyJoinedRoomResponse;
  trySchedulePlayerReadyRef.current = trySchedulePlayerReady;

  const handleMatchmakingAutoJoin = useCallback(
    (payload: MatchFoundPayload) => {
      const activeSocket = socketRef.current;
      if (!canAttemptMatchmakingRoomJoin({ socket: activeSocket, roomCode: payload.roomCode, currentJoinedRoom: selectJoinedRoomCode(sessionRef.current), normalizeRoomCode })) { return; }
      setOverlayPayload(payload);
      setAppMode('multiplayer');
      const username = authProfile?.username ?? authUser?.email?.split('@')[0] ?? 'Guest';
      void emitMatchmakingRoomJoin({ socket: activeSocket!, roomCode: payload.roomCode, identity: { username, userId: multiplayerIdentityUserId, authToken: multiplayerAuthToken } }).then((resp) => {
        handleMatchmakingRoomJoinAck(resp, { applyJoinedRoomResponse, showToast });
      });
    },
    [authProfile?.username, authUser?.email, multiplayerIdentityUserId, multiplayerAuthToken, applyJoinedRoomResponse, showToast, setAppMode, setOverlayPayload, socketRef, sessionRef, normalizeRoomCode],
  );

  return {
    getInviteLink,
    resolvePendingCreate,
    resetClientGameSession,
    resetMultiplayerRoomState,
    clearRecoverableRoomState,
    applyRoomEventMeta,
    emitCreateRoom,
    trySchedulePlayerReady,
    schedulePlayerReady,
    applyJoinedRoomResponse,
    handleJoinAck,
    handleMatchmakingAutoJoin,
  };
}
