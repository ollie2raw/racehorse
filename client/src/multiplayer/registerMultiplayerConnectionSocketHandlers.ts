import type { Socket } from 'socket.io-client';
import { logger } from '../utils/logger';
import type { RoomChatEvent, RoomEmoteEvent } from './protocol';
import { wrapSocketHandler } from './socketGuards';
import type { MultiplayerConnectionScope } from './multiplayerConnectionScope';
import type { TournamentMatchAssignedPayload } from './legacyTournamentTypes';
import type { RecoveryEvent } from './recoveryMachine';
import {
  dispatchSocketEvent,
  registerNormalizedSocketRouter,
  registerRawSocketEventHandler,
  type RawSocketHandler,
} from './socketEventBus';
import { SOCKET_EVENTS } from './socketEventRegistry';
import type { RecoveryMachine } from './recoveryMachine';
import type { RefBox } from './refBox';
import {
  selectIntentionalDisconnect,
  selectJoinedRoomCode,
} from './session/sessionStateMachine';
export function registerMultiplayerConnectionSocketHandlers(options: {
  getScope: () => MultiplayerConnectionScope;
  recoveryMachineRef: RefBox<RecoveryMachine | null>;
  dispatchRecovery: (event: RecoveryEvent) => void;
  syncMachineToLegacy: () => void;
  trySavedRoomAutoJoin: (socket: Socket) => Promise<void>;
  recoverState: () => void;
}): () => void {
  const {
    getScope,
    recoveryMachineRef,
    dispatchRecovery,
    syncMachineToLegacy,
    trySavedRoomAutoJoin,
    recoverState,
  } = options;

  const unregisterRouter = registerNormalizedSocketRouter({
    resyncNeeded: ({ roomCode }) => {
      dispatchRecovery({ type: 'RESYNC_NEEDED', roomCode });
    },
    transportFail: ({ reason, roomCode }) => {
      if (roomCode) {
        dispatchRecovery({ type: 'SOCKET_LOST', roomCode });
        return;
      }
      dispatchRecovery({ type: 'TRANSPORT_FAIL', reason });
    },
    roomJoinTerminal: ({ error }) => {
      dispatchRecovery({ type: 'ROOM_JOIN_TERMINAL', error });
    },
  });

  const unregisters: Array<() => void> = [unregisterRouter];

  const register = (eventName: string, handler: (...args: never[]) => void) => {
    unregisters.push(registerRawSocketEventHandler(eventName, handler as RawSocketHandler));
  };

  register(
    SOCKET_EVENTS.CONNECT,
    wrapSocketHandler(SOCKET_EVENTS.CONNECT, () => {
      void (async () => {
        const scope = getScope();
        scope.session.dispatchSession({ type: 'SOCKET_CONNECTED' });
        if (selectIntentionalDisconnect(scope.session.sessionRef.current)) return;
        scope.ui.setIsConnected(true);
        scope.ui.setIsConnecting(false);
        scope.ui.setServerWaking(false);

        const userId = scope.auth.authUserRef.current?.id;
        const username =
          scope.auth.authProfileRef.current?.username ??
          scope.auth.authUserRef.current?.email?.split('@')[0] ??
          'player';
        if (userId) {
          const socket = scope.socket.socketRef.current;
          if (socket?.connected) {
            void scope.config
              .emitWithAck(socket, 'presence:identify', {
                userId,
                username,
                authToken: scope.auth.authAccessTokenRef.current,
              })
              .catch((error) => {
                if (import.meta.env.DEV) {
                  console.log(
                    '[presence] identify failed',
                    error instanceof Error ? error.message : error,
                  );
                }
              });
          }
        }

        if (scope.joinFlight.pendingCreateOnConnectRef.current) {
          scope.joinFlight.pendingCreateOnConnectRef.current = false;
          const socket = scope.socket.socketRef.current;
          if (socket) {
            void scope.config.emitCreateRoom(socket).catch((error) => {
              const message = error instanceof Error ? error.message : 'Action failed';
              scope.ui.setError(message);
              scope.config.showToast(message, 2000);
            });
          }
          return;
        }

        dispatchRecovery({ type: 'SOCKET_CONNECTED' });

        const socket = scope.socket.socketRef.current;
        if (socket?.connected) {
          await trySavedRoomAutoJoin(socket);
        }
      })();
    }, { recoverOnError: recoverState }),
  );

  register(
    SOCKET_EVENTS.DISCONNECT,
    wrapSocketHandler(SOCKET_EVENTS.DISCONNECT, (reason) => {
      const scope = getScope();
      const roomBeforeDisconnect = selectJoinedRoomCode(scope.session.sessionRef.current);
      const isRecoverableSession =
        Boolean(roomBeforeDisconnect) &&
        !selectIntentionalDisconnect(scope.session.sessionRef.current);

      scope.ui.setIsConnected(false);
      scope.ui.setIsConnecting(false);
      scope.ui.setError('');
      scope.ui.setActionError('');
      scope.ui.setRematchRequested(false);
      scope.ui.setRematchReadyIds([]);
      scope.ui.setOpponentDragging(false);
      scope.gameplay.draggingStateRef.current = false;

      if (isRecoverableSession && roomBeforeDisconnect) {
        scope.recovery.clearTransientRoomUi();
        logger.operational('socket', 'disconnected_mid_game', {
          reason,
          roomCode: roomBeforeDisconnect,
        });
        dispatchSocketEvent({
          type: 'TRANSPORT_FAIL',
          payload: { reason: String(reason), roomCode: roomBeforeDisconnect },
        });
        return;
      }

      scope.session.dispatchSession({ type: 'ROOM_LEFT' });
      scope.session.dispatchSession({ type: 'SOCKET_DISCONNECTED' });
      scope.ui.setJoinedRoom(null);
      scope.ui.setState(null);
      scope.ui.setLegalMoves([]);
      scope.ui.setCanDraw(false);
      scope.ui.setTournamentActiveRoom(null);
      syncMachineToLegacy();
    }),
  );

  register(
    SOCKET_EVENTS.TOURNAMENT_MATCH_ASSIGNED,
    wrapSocketHandler(SOCKET_EVENTS.TOURNAMENT_MATCH_ASSIGNED, (data: TournamentMatchAssignedPayload) => {
      const scope = getScope();
      const socketId = scope.socket.socketRef.current?.id;
      if (typeof data?.roomCode === 'string') scope.ui.setTournamentActiveRoom(data.roomCode);
      if (data?.roomCode && (data?.a === socketId || data?.b === socketId)) {
        const code = String(data.roomCode).trim().toUpperCase();
        scope.ui.setJoinedRoom(code);
        scope.ui.setRoomCode(code);
        scope.navigation.setAppMode('multiplayer');
      }
    }),
  );

  register(
    SOCKET_EVENTS.ROOM_CHAT,
    wrapSocketHandler(SOCKET_EVENTS.ROOM_CHAT, (msg: RoomChatEvent) => {
      getScope().social.appendRoomReactionRef.current(msg);
    }),
  );

  register(
    SOCKET_EVENTS.ROOM_EMOTE,
    wrapSocketHandler(SOCKET_EVENTS.ROOM_EMOTE, (evt: RoomEmoteEvent) => {
      getScope().social.appendRoomReactionRef.current(evt);
    }),
  );

  register(
    SOCKET_EVENTS.ROOM_SESSION_SUPERSEDED,
    wrapSocketHandler(SOCKET_EVENTS.ROOM_SESSION_SUPERSEDED, () => {
      const scope = getScope();
      if (selectIntentionalDisconnect(scope.session.sessionRef.current)) return;
      const roomCode = selectJoinedRoomCode(scope.session.sessionRef.current);
      if (!roomCode) return;
      scope.session.dispatchSession({ type: 'ROOM_SESSION_SUPERSEDED' });
      scope.config.showToast('Session moved to this device. Syncing…', 1600);
      dispatchRecovery({ type: 'SESSION_SUPERSEDED', roomCode });
    }),
  );

  register(
    SOCKET_EVENTS.CONNECT_ERROR,
    wrapSocketHandler(SOCKET_EVENTS.CONNECT_ERROR, () => {
      const scope = getScope();
      scope.ui.setIsConnecting(false);
      const machineState = recoveryMachineRef.current?.getSnapshot().state;
      if (machineState === 'connecting' || machineState === 'joining') {
        dispatchSocketEvent({ type: 'TRANSPORT_FAIL', payload: { reason: 'connect_error' } });
        return;
      }
      scope.ui.setServerWaking(true);
      scope.ui.setError('');
    }),
  );

  register(
    SOCKET_EVENTS.RECONNECT_FAILED,
    wrapSocketHandler(SOCKET_EVENTS.RECONNECT_FAILED, () => {
      const scope = getScope();
      scope.ui.setIsConnecting(false);
      const machineState = recoveryMachineRef.current?.getSnapshot().state;
      if (machineState === 'connecting' || machineState === 'joining') {
        dispatchSocketEvent({ type: 'TRANSPORT_FAIL', payload: { reason: 'reconnect_failed' } });
      }
    }),
  );

  register(
    SOCKET_EVENTS.SERVER_SHUTDOWN,
    wrapSocketHandler(SOCKET_EVENTS.SERVER_SHUTDOWN, (payload: { reason?: string } | undefined) => {
      const scope = getScope();
      dispatchRecovery({ type: 'SET_POLICY', policy: 'disabled' });
      scope.config.showToast(
        'Server is updating. You may need to rejoin your match from the lobby.',
        4000,
      );
      if (import.meta.env.DEV) {
        console.warn('[socket] server:shutdown', payload);
      }
    }),
  );

  return () => {
    for (const unregister of unregisters) {
      unregister();
    }
  };
}