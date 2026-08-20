import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { io, type Socket } from 'socket.io-client';
import { dispatchSocketEvent } from './socketEventBus';
import {
  applyGameRematchStartedSocketEvent,
  applyGameRematchStatusSocketEvent,
  applyHandEndedSocketEvent,
  applyPlayerDraggingSocketEvent,
} from './connectionGameplaySocketHandlers';
import { gameplaySocketScopeRef } from './gameplaySocketScope';
import { registerMultiplayerConnectionGameplaySocketHandlers } from './registerMultiplayerConnectionGameplaySocketHandlers';
import { registerMultiplayerConnectionSocketHandlers } from './registerMultiplayerConnectionSocketHandlers';
import { emitRoomAbandonMatch, emitRoomLeave, type RoomAckResponse } from './roomTransport';
import { getOrCreateGuestDisplayName } from '../match/recovery/matchRecovery';

import { syncRecoveryLegacyRefs } from './recoveryConnectionBridge';
import {
  createRecoveryMachine,
  type RecoveryEffect,
  type RecoveryEvent,
  type RecoveryMachine,
  type RecoveryMachineSnapshot,
} from './recoveryMachine';
import {
  createMultiplayerConnectionScope,
  type MultiplayerConnectionScope,
  type MultiplayerConnectionScopeSource,
} from './multiplayerConnectionScope';
import {
  createLifecycleHiddenTracker,
  evaluateLifecycleResumeResync,
} from './multiplayerLifecycleRecovery';
import {
  recordJoinLatency,
  recordResyncRequested,
  recordResyncSkipped,
} from './mpTelemetry';
import {
  selectIntentionalDisconnect,
  selectJoinedRoomCode,
  selectMatchStarted,
} from './session/sessionStateMachine';
import type { RecoveredPrivateMatchUi } from './terminalRoomArchiveRecovery';
import { handleTerminalJoinFailure } from './handleTerminalJoinFailure';
import {
  beginRoomOperation,
  invalidateRoomOperations,
  isCurrentRoomOperation,
} from './roomOperationEpoch';

type SocketWithPing = Socket & { __mpPingTimer?: ReturnType<typeof setInterval> };

export type UseMultiplayerConnectionParams = MultiplayerConnectionScopeSource & {
  recoveryDispatchRef?: MutableRefObject<(event: RecoveryEvent) => RecoveryMachineSnapshot | null>;
  setRecoveredPrivateMatch?: (recovered: RecoveredPrivateMatchUi) => void;
};

export function useMultiplayerConnection(params: UseMultiplayerConnectionParams) {
  const scopeRef = useRef<MultiplayerConnectionScope>(null!);
  useLayoutEffect(() => {
    scopeRef.current = createMultiplayerConnectionScope(params);
  });
  const { connectionState, config } = params;
  const setRecoveredPrivateMatch = params.setRecoveredPrivateMatch;

  const recoveryMachineRef = useRef<RecoveryMachine | null>(null);
  const establishSocketRef = useRef<() => void>(() => {});
  const handleRecoveryEffectRef = useRef<(effect: RecoveryEffect) => void>(() => {});

  const syncMachineToLegacy = useCallback(() => {
    const machine = recoveryMachineRef.current;
    if (!machine) return;
    const scope = scopeRef.current;
    syncRecoveryLegacyRefs(machine.getSnapshot(), {
      reconnectShouldJoinRef: scope.reconnect.reconnectShouldJoinRef,
      preventAutoRejoinRef: scope.reconnect.preventAutoRejoinRef,
      reconnectRoomCodeRef: scope.reconnect.reconnectRoomCodeRef,
      reconnectAttemptCountRef: scope.reconnect.reconnectAttemptCountRef,
      rejoinInFlightRef: scope.reconnect.rejoinInFlightRef,
      setRoomRecoveryState: scope.ui.setRoomRecoveryState,
      setRoomRecoveryMessage: scope.ui.setRoomRecoveryMessage,
      setIsRecoveringConnection: scope.ui.setIsRecoveringConnection,
    });
  }, []);

  const dispatchRecovery = useCallback(
    (event: RecoveryEvent): RecoveryMachineSnapshot | null => {
      const machine = recoveryMachineRef.current;
      if (!machine) return null;
      const snapshot = machine.dispatch(event);
      syncMachineToLegacy();
      return snapshot;
    },
    [syncMachineToLegacy],
  );

  const executeRecoveryRoomJoin = useCallback(
    async (roomCode: string) => {
      const scope = scopeRef.current;
      const socket = scope.socket.socketRef.current;
      if (!socket?.connected) {
        dispatchRecovery({ type: 'TRANSPORT_FAIL', reason: 'socket_not_connected' });
        return;
      }

      const rejoinIdentity = scope.room.roomIdentityRef.current ?? {
        username: scope.auth.authProfileRef.current?.username ?? getOrCreateGuestDisplayName(),
        userId: scope.auth.multiplayerIdentityUserIdRef.current,
        authToken: scope.auth.authAccessTokenRef.current,
      };

      const operationToken = beginRoomOperation(scope.roomOperationEpochRef);
      try {
        const rejoinStartedAt =
          typeof performance !== 'undefined' ? performance.now() : Date.now();
        const resp = await scope.config.emitWithAck<RoomAckResponse>(
          socket,
          'room:join',
          roomCode,
          rejoinIdentity,
        );

        if (!isCurrentRoomOperation(scope.roomOperationEpochRef, operationToken)) {
          return;
        }

        if (resp?.ok) {
          const rejoinEndedAt =
            typeof performance !== 'undefined' ? performance.now() : Date.now();
          recordJoinLatency(rejoinEndedAt - rejoinStartedAt, 'rejoin');
          const wasRecovery = recoveryMachineRef.current?.getSnapshot().state === 'joining';
          scope.recovery.applyJoinedRoomResponse(resp);
          const terminalTournamentJoin =
            Boolean(resp?.tournamentMatch?.matchId) &&
            Boolean((resp?.state as { gameOver?: boolean } | null | undefined)?.gameOver);
          if (terminalTournamentJoin) {
            dispatchRecovery({ type: 'SET_POLICY', policy: 'disabled' });
            dispatchRecovery({ type: 'SET_TARGET_ROOM', roomCode: null });
            dispatchRecovery({ type: 'ROOM_JOIN_OK' });
            return;
          }
          dispatchRecovery({ type: 'ROOM_JOIN_OK' });
          if (wasRecovery) {
            scope.config.showToast('Reconnected to room.', 1200);
          } else {
            scope.navigation.setAppMode('multiplayer');
          }
          return;
        }

        const errorText = String(resp?.error ?? 'not_ok');
        const terminalHandled = await handleTerminalJoinFailure({
          resp,
          roomCode,
          serverUrl: scope.config.serverUrl,
          authToken: scope.auth.authAccessTokenRef.current,
          setRecoveredPrivateMatch,
          onNavigateMultiplayer: () => scope.navigation.setAppMode('multiplayer'),
          dispatchRecovery,
        });
        if (!isCurrentRoomOperation(scope.roomOperationEpochRef, operationToken)) {
          return;
        }
        if (terminalHandled === 'handled') {
          return;
        }
        dispatchRecovery({ type: 'ROOM_JOIN_TRANSIENT', error: errorText });
      } catch (error) {
        if (!isCurrentRoomOperation(scope.roomOperationEpochRef, operationToken)) {
          return;
        }
        dispatchRecovery({
          type: 'TRANSPORT_FAIL',
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [dispatchRecovery, setRecoveredPrivateMatch],
  );

  const executeRecoveryResync = useCallback(
    async (_roomCode: string) => {
      const success = await scopeRef.current.recovery.fetchGameState('recovery_machine');
      if (success) {
        dispatchRecovery({ type: 'RESYNC_OK' });
      } else {
        dispatchRecovery({ type: 'RESYNC_FAIL' });
      }
    },
    [dispatchRecovery],
  );

  useEffect(() => {
    handleRecoveryEffectRef.current = (effect: RecoveryEffect) => {
      const scope = scopeRef.current;
      switch (effect.type) {
        case 'connect':
          establishSocketRef.current();
          break;
        case 'room_join':
          void executeRecoveryRoomJoin(effect.roomCode);
          break;
        case 'resync':
          void executeRecoveryResync(effect.roomCode);
          break;
        case 'clear_terminal_room':
          if (typeof window !== 'undefined') {
            window.localStorage.removeItem(scope.config.lastRoomStorageKey);
          }
          break;
        case 'cancel_schedule':
          scope.reconnect.reconnectAttemptTimerRef.current = null;
          break;
        default:
          break;
      }
    };
  }, [executeRecoveryResync, executeRecoveryRoomJoin]);

  useEffect(() => {
    if (!recoveryMachineRef.current) {
      recoveryMachineRef.current = createRecoveryMachine({
        onEffect: (effect) => handleRecoveryEffectRef.current(effect),
      });
    }
  }, []);

  useEffect(() => {
    const recoveryDispatchBridgeRef = params.recoveryDispatchRef;
    if (recoveryDispatchBridgeRef) {
      recoveryDispatchBridgeRef.current = dispatchRecovery;
    }
  }, [dispatchRecovery]);

  useEffect(() => {
    const machine = recoveryMachineRef.current;
    return () => {
      machine?.dispose();
      scopeRef.current.recovery.clearReconnectAttemptTimer();
    };
  }, []);

  const lifecycleHiddenTrackerRef = useRef(createLifecycleHiddenTracker());
  const lastLifecycleResyncAtRef = useRef(0);

  useEffect(() => {
    const hiddenTracker = lifecycleHiddenTrackerRef.current;

    const handleLifecycleResume = () => {
      const now = Date.now();
      const hiddenSinceMs = hiddenTracker.consumeHiddenSince(now);
      const scope = scopeRef.current;
      const roomCode = selectJoinedRoomCode(scope.session.sessionRef.current);
      const decision = evaluateLifecycleResumeResync({
        now,
        hiddenSinceMs,
        roomCode,
        matchStarted: selectMatchStarted(scope.session.sessionRef.current),
        recoveryState: recoveryMachineRef.current?.getSnapshot().state ?? 'idle',
        socketConnected: Boolean(scope.socket.socketRef.current?.connected),
        resyncInFlight: scope.recovery.resyncInFlightRef.current,
        rejoinInFlight: scope.reconnect.rejoinInFlightRef.current,
        intentionalDisconnect: selectIntentionalDisconnect(scope.session.sessionRef.current),
        lastLifecycleResyncAtMs: lastLifecycleResyncAtRef.current,
      });

      if (!decision.shouldResync || !roomCode) {
        if (decision.reason && decision.reason !== 'hidden_duration_short') {
          recordResyncSkipped(`lifecycle_${decision.reason}`, { roomCode });
        }
        return;
      }

      lastLifecycleResyncAtRef.current = now;
      recordResyncRequested('lifecycle_resume', { roomCode, reason: decision.reason });
      dispatchSocketEvent({ type: 'RESYNC_NEEDED', payload: { roomCode } });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenTracker.markHidden(Date.now());
        return;
      }
      handleLifecycleResume();
    };

    const onPageHide = () => {
      hiddenTracker.markHidden(Date.now());
    };

    const onPageShow = () => {
      handleLifecycleResume();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      hiddenTracker.reset();
    };
  }, []);

  const trySavedRoomAutoJoin = useCallback(
    async (socket: Socket) => {
      const scope = scopeRef.current;
      if (scope.reconnect.preventAutoRejoinRef.current || scope.joinFlight.autoJoinAttemptedRef.current) {
        return;
      }
      const savedCode = scope.config.normalizeRoomCode(
        (typeof window !== 'undefined' && window.localStorage.getItem(scope.config.lastRoomStorageKey)) || '',
      );
      if (!savedCode || selectJoinedRoomCode(scope.session.sessionRef.current)) return;
      const operationToken = beginRoomOperation(scope.roomOperationEpochRef);
      scope.joinFlight.autoJoinAttemptedRef.current = true;
      try {
        const joinStartedAt =
          typeof performance !== 'undefined' ? performance.now() : Date.now();
        const resp = await scope.config.emitWithAck<RoomAckResponse>(socket, 'room:join', savedCode, {
          username: scope.state.authProfileUsername ?? getOrCreateGuestDisplayName(),
          userId: scope.auth.multiplayerIdentityUserIdRef.current,
          authToken: scope.auth.authAccessTokenRef.current,
        });
        if (!isCurrentRoomOperation(scope.roomOperationEpochRef, operationToken)) {
          return;
        }

        if (resp?.ok) {
          const joinEndedAt =
            typeof performance !== 'undefined' ? performance.now() : Date.now();
          recordJoinLatency(joinEndedAt - joinStartedAt, 'join');
        }
        if (!resp?.ok) {
          const terminalHandled = await handleTerminalJoinFailure({
            resp,
            roomCode: savedCode,
            serverUrl: scope.config.serverUrl,
            authToken: scope.auth.authAccessTokenRef.current,
            lastRoomStorageKey: scope.config.lastRoomStorageKey,
            clearSavedRoomOnAttempt: true,
            restoreSavedRoomOnDegraded: true,
            setRecoveredPrivateMatch,
            onNavigateMultiplayer: () => scope.navigation.setAppMode('multiplayer'),
            dispatchRecovery,
          });
          if (!isCurrentRoomOperation(scope.roomOperationEpochRef, operationToken)) {
            return;
          }
          if (terminalHandled === 'handled') {
            return;
          }
          scope.config.showToast('Saved room is no longer available.', 2000);
          return;
        }
        const isPrivateRoom = !resp.matchmakingMatchId && !resp.scheduledTournamentMatchId;
        scope.ui.setMpSubView(isPrivateRoom ? 'private' : 'quick');
        scope.recovery.applyJoinedRoomResponse(resp);
        scope.config.showToast('Rejoined room.', 1200);
      } catch (error) {
        if (!isCurrentRoomOperation(scope.roomOperationEpochRef, operationToken)) {
          return;
        }
        scope.config.showToast(error instanceof Error ? error.message : 'Action failed', 2000);
      }
    },
    [dispatchRecovery, setRecoveredPrivateMatch],
  );

  useEffect(() => {
    const recoverState = () => {
      const roomCode = selectJoinedRoomCode(scopeRef.current.session.sessionRef.current);
      if (!roomCode) return;
      if (recoveryMachineRef.current?.getSnapshot().state === 'idle') {
        dispatchSocketEvent({ type: 'RESYNC_NEEDED', payload: { roomCode } });
      }
    };

    const unregisterConnection = registerMultiplayerConnectionSocketHandlers({
      getScope: () => scopeRef.current,
      recoveryMachineRef,
      dispatchRecovery,
      syncMachineToLegacy,
      trySavedRoomAutoJoin,
      recoverState,
    });
    gameplaySocketScopeRef.current.gameplay = {
      onHandEnded: (payload) => {
        applyHandEndedSocketEvent(scopeRef.current, payload, () => scopeRef.current);
      },
      onGameRematchStatus: (payload) => {
        applyGameRematchStatusSocketEvent(scopeRef.current, payload);
      },
      onGameRematchStarted: () => {
        applyGameRematchStartedSocketEvent(scopeRef.current);
      },
      onPlayerDragging: (payload) => {
        applyPlayerDraggingSocketEvent(scopeRef.current, payload);
      },
    };

    const unregisterGameplay = registerMultiplayerConnectionGameplaySocketHandlers({
      getScope: () => gameplaySocketScopeRef.current,
      recoverState,
    });
    return () => {
      gameplaySocketScopeRef.current.gameplay = null;
      unregisterConnection();
      unregisterGameplay();
    };
  }, [dispatchRecovery, syncMachineToLegacy, trySavedRoomAutoJoin]);

  const establishSocket = useCallback(() => {
    const scope = scopeRef.current;
    if (scope.state.socket?.connected) return;
    if (scope.state.socket && !scope.state.socket.connected && scope.state.socket.active) return;
    if (scope.state.isConnecting) return;
    scope.session.dispatchSession({ type: 'INTENTIONAL_DISCONNECT', value: false });
    scope.ui.setError('');
    scope.ui.setIsConnecting(true);
    if (scope.state.socket && !scope.state.socket.connected) {
      const oldSocket = scope.state.socket as SocketWithPing;
      if (oldSocket.__mpPingTimer) clearInterval(oldSocket.__mpPingTimer);
      oldSocket.removeAllListeners();
      oldSocket.io.removeAllListeners();
      oldSocket.disconnect();
    }

    const s = io(scope.config.serverUrl, {
      transports: ['polling', 'websocket'],
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    const pingSocket = s as SocketWithPing;
    pingSocket.__mpPingTimer = setInterval(() => {
      if (!s.connected) return;
      const sentAt = performance.now();
      s.emit('mp:ping', sentAt, () => {
        if (
          import.meta.env.DEV &&
          typeof window !== 'undefined' &&
          window.localStorage.getItem('mp_debug') === '1'
        ) {
          console.info('[mp-ping]', `${Math.round(performance.now() - sentAt)}ms`);
        }
      });
    }, 5000);

    scope.ui.setSocket(s);
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      (window as Window & { __racehorseE2eSocket?: Socket }).__racehorseE2eSocket = s;
    }
  }, [dispatchRecovery, syncMachineToLegacy, trySavedRoomAutoJoin]);

  useLayoutEffect(() => {
    establishSocketRef.current = establishSocket;
  }, [establishSocket]);

  const connect = useCallback(() => {
    establishSocketRef.current();
  }, []);

  useEffect(() => {
    return () => {
      const scope = scopeRef.current;
      scope.session.dispatchSession({ type: 'INTENTIONAL_DISCONNECT', value: true });
      invalidateRoomOperations(scope.roomOperationEpochRef);
      recoveryMachineRef.current?.dispose();
      scope.recovery.clearReconnectAttemptTimer();
      const sock = scope.socket.socketRef.current as SocketWithPing | null;
      if (sock) {
        if (sock.__mpPingTimer) clearInterval(sock.__mpPingTimer);
        sock.removeAllListeners();
        sock.io.removeAllListeners();
        sock.disconnect();
        scope.socket.socketRef.current = null;
      }
    };
  }, []);

  const retryRoomRecovery = useCallback(() => {
    const scope = scopeRef.current;
    const roomCode = selectJoinedRoomCode(scope.session.sessionRef.current);
    if (!roomCode) return;
    scope.session.dispatchSession({ type: 'INTENTIONAL_DISCONNECT', value: false });
    dispatchRecovery({ type: 'SET_TARGET_ROOM', roomCode });
    dispatchRecovery({ type: 'USER_RETRY' });
    scope.ui.setError('');
    scope.ui.setActionError('');
  }, [dispatchRecovery]);

  /**
   * Transport-level disconnect. Closes the socket, emits leave/abandon if in a room,
   * and resets navigation + recovery flags.
   *
   * Does NOT clear room roster, game shell state, or tournament context.
   * Callers are responsible for calling resetMultiplayerRoomState() after disconnect
   * to clear room and shell state.
   *
   * @see resetMultiplayerRoomState in App.tsx
   */
  const disconnect = useCallback((reason: string = 'user requested') => {
    const scope = scopeRef.current;
    if (import.meta.env.DEV) {
      console.warn('[nav] redirect home', {
        reason,
        appMode: scope.state.appMode,
        joinedRoom: selectJoinedRoomCode(scope.session.sessionRef.current),
        gameOver: scope.room.stateRef.current?.gameOver ?? null,
        handOver: scope.room.stateRef.current?.handOver ?? null,
      });
    }
      scope.session.dispatchSession({ type: 'INTENTIONAL_DISCONNECT', value: true });
    invalidateRoomOperations(scope.roomOperationEpochRef);
      dispatchRecovery({ type: 'USER_LEAVE' });
    scope.joinFlight.autoJoinAttemptedRef.current = false;
    scope.navigation.setAppMode('home');
    const socket = scope.socket.socketRef.current;
    const activeRoomCode = scope.config.normalizeRoomCode(
      selectJoinedRoomCode(scope.session.sessionRef.current),
    );
    const midActiveMatch = Boolean(scope.room.stateRef.current && !scope.room.stateRef.current.gameOver);

    void (async () => {
      if (socket?.connected && activeRoomCode) {
        if (midActiveMatch) {
          try {
            await emitRoomAbandonMatch(socket, {
              roomCode: activeRoomCode,
              tournamentMatchId: null,
            });
          } catch (abandonErr) {
            if (import.meta.env.DEV) {
              console.warn('[nav] abandon failed, falling back to room:leave', abandonErr);
            }
            emitRoomLeave(socket, activeRoomCode);
          }
        } else {
          emitRoomLeave(socket, activeRoomCode);
        }
      }
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
        if (scope.socket.socketRef.current === socket) scope.socket.socketRef.current = null;
      }
    })();

    if (socket && scope.socket.socketRef.current === socket) scope.socket.socketRef.current = null;
    scope.ui.setSocket(null);
    scope.ui.setError('');
    scope.ui.setActionError('');
    scope.ui.setYou('');
    scope.ui.setIsConnected(false);
    scope.ui.setIsConnecting(false);
    scope.gameplay.draggingStateRef.current = false;
    scope.navigation.setAppMode('home');
    scope.joinFlight.autoConnectAttemptedRef.current = false;
  }, [dispatchRecovery]);

  useEffect(() => {
    scopeRef.current.socket.connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    const scope = scopeRef.current;
    if (scope.state.appMode !== 'multiplayer' && scope.state.appMode !== 'tournament') return;
    if (scope.joinFlight.autoConnectAttemptedRef.current) return;
    if (!scope.config.serverUrl) return;
    scope.session.dispatchSession({ type: 'INTENTIONAL_DISCONNECT', value: false });
    scope.joinFlight.autoConnectAttemptedRef.current = true;
    connect();
  }, [connectionState.appMode, config.serverUrl, connect]);

  useEffect(() => {
    const scope = scopeRef.current;
    if (scope.state.appMode !== 'tournament') return;
    if (scope.state.socket) return;
    scope.session.dispatchSession({ type: 'INTENTIONAL_DISCONNECT', value: false });
    connect();
  }, [connectionState.appMode, connectionState.socket, connect]);

  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope.state.authUserId) return;
    if (!scope.config.serverUrl || scope.state.socket || scope.state.isConnecting) return;
    if (selectIntentionalDisconnect(scope.session.sessionRef.current)) return;
    connect();
  }, [
    connectionState.authUserId,
    config.serverUrl,
    connectionState.socket,
    connectionState.isConnecting,
    connect,
  ]);

  const prevPresenceAuthFingerprintRef = useRef<string | null>(null);

  // Re-emit presence:identify when auth identity changes while socket is connected.
  // Handles: token refresh, username change, late auth (auth completes after connect).
  // Connect/reconnect identify stays in the connect handler; skip first fingerprint to avoid duplicate on connect.
  useEffect(() => {
    const fingerprint = [
      connectionState.authUserId ?? '',
      connectionState.authEmail ?? '',
      connectionState.authProfileUsername ?? '',
      connectionState.authAccessToken ?? '',
    ].join('|');

    const prev = prevPresenceAuthFingerprintRef.current;
    prevPresenceAuthFingerprintRef.current = fingerprint;

    if (prev === null) return;
    if (prev === fingerprint) return;

    const scope = scopeRef.current;
    const socket = scope.socket.socketRef?.current;
    if (!socket?.connected) return;

    const userId = scope.auth.authUserRef.current?.id;
    if (!userId) return;

    const username =
      scope.auth.authProfileRef.current?.username ??
      scope.auth.authUserRef.current?.email?.split('@')[0] ??
      'player';

    void scope.config.emitWithAck<RoomAckResponse>(socket, 'presence:identify', {
      userId,
      username,
      authToken: scope.auth.authAccessTokenRef.current,
    }).catch((error) => {
      if (import.meta.env.DEV) {
        console.log(
          '[presence] re-identify on auth change failed',
          error instanceof Error ? error.message : error,
        );
      }
    });
  }, [
    connectionState.authUserId,
    connectionState.authEmail,
    connectionState.authProfileUsername,
    connectionState.authAccessToken,
  ]);

  return {
    connect,
    retryRoomRecovery,
    disconnect,
    recoveryDispatch: dispatchRecovery,
  };
}
