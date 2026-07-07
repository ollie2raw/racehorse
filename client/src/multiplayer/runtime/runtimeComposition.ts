import { createSessionStateMachine } from '../session/sessionStateMachine';
import { INITIAL_SESSION_SNAPSHOT, type SessionEvent } from '../session/sessionTypes';
import type {
  ControllerRuntimeSlice,
  MultiplayerRuntimeBootstrap,
  ProjectionRuntimeSlice,
  SessionRuntimeSlice,
  SocketRegistrarRuntimeSlice,
} from './runtimeTypes';
import type { MultiplayerRecoveryRuntime } from './recoveryRuntime';
import type { MultiplayerGameplayRefsRuntime } from './gameplayRuntime';
import type {
  MultiplayerAuthRuntime,
  MultiplayerReconnectRuntime,
  MultiplayerSocketRuntime,
} from './connectionRuntime';
import type { MultiplayerJoinFlightRuntime, MultiplayerRoomRuntime } from './roomRuntime';
import type { MultiplayerNavigationRuntime } from './navigationRuntime';
import type { TournamentAttachRuntime } from './tournamentRuntime';

function freeze<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

/** Pure session FSM runtime — no React, no sockets. */
export function createSessionRuntime(): SessionRuntimeSlice {
  const machine = createSessionStateMachine(INITIAL_SESSION_SNAPSHOT);
  const sessionRef = { current: machine.getSnapshot() };
  const listeners = new Set<() => void>();

  const dispatchSession = (event: SessionEvent) => {
    sessionRef.current = machine.dispatch(event);
    for (const listener of listeners) {
      listener();
    }
  };

  return freeze({
    sessionRef,
    dispatchSession,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => sessionRef.current,
  });
}

export function createRecoveryRuntime(
  bootstrap: MultiplayerRuntimeBootstrap,
): MultiplayerRecoveryRuntime {
  return freeze({
    applyJoinedRoomResponseRef: bootstrap.applyJoinedRoomResponseRef,
    clearRecoverableRoomStateRef: bootstrap.clearRecoverableRoomStateRef,
    resetMultiplayerRoomStateRef: bootstrap.resetMultiplayerRoomStateRef,
    resyncInFlightRef: bootstrap.resyncInFlightRef,
    resyncBufferedUpdateRef: bootstrap.resyncBufferedUpdateRef,
    resyncFlushRef: bootstrap.resyncFlushRef,
    rematchAwaitingStateRef: bootstrap.rematchAwaitingStateRef,
  });
}

export function createProjectionRuntime(): ProjectionRuntimeSlice {
  return freeze({
    owner: 'projection.layer',
    ingress: 'socketEventBus.STATE_UPDATE',
    applyPath: 'multiplayer/projection',
  });
}

export function createSocketRegistrarRuntime(): SocketRegistrarRuntimeSlice {
  return freeze({
    connectionRegistrar: 'multiplayer/registerMultiplayerConnectionSocketHandlers',
    gameplayRegistrar: 'multiplayer/registerMultiplayerConnectionGameplaySocketHandlers',
    roomSyncRegistrar: 'multiplayer/useRoomSocketSync',
    tournamentRegistrar: 'tournament/registerTournamentSocketHandlers',
  });
}

export function createSocketRuntime(
  bootstrap: MultiplayerRuntimeBootstrap,
): MultiplayerSocketRuntime {
  return freeze({
    socketRef: bootstrap.socketRef,
    connectRef: bootstrap.connectRef,
  });
}

export function createJoinFlightRuntime(
  bootstrap: MultiplayerRuntimeBootstrap,
): MultiplayerJoinFlightRuntime {
  return freeze({
    pendingCreateOnConnectRef: bootstrap.pendingCreateOnConnectRef,
    pendingCreateResolversRef: bootstrap.pendingCreateResolversRef,
    autoJoinAttemptedRef: bootstrap.autoJoinAttemptedRef,
    joinInFlightRef: bootstrap.joinInFlightRef,
    createInFlightRef: bootstrap.createInFlightRef,
    inviteJoinInFlightRef: bootstrap.inviteJoinInFlightRef,
    autoConnectAttemptedRef: bootstrap.autoConnectAttemptedRef,
  });
}

export function createReconnectRuntime(
  bootstrap: MultiplayerRuntimeBootstrap,
): MultiplayerReconnectRuntime {
  return freeze({
    reconnectRoomCodeRef: bootstrap.reconnectRoomCodeRef,
    reconnectShouldJoinRef: bootstrap.reconnectShouldJoinRef,
    preventAutoRejoinRef: bootstrap.preventAutoRejoinRef,
    reconnectAttemptTimerRef: bootstrap.reconnectAttemptTimerRef,
    reconnectAttemptCountRef: bootstrap.reconnectAttemptCountRef,
    rejoinInFlightRef: bootstrap.rejoinInFlightRef,
  });
}

export function createAuthRuntime(bootstrap: MultiplayerRuntimeBootstrap): MultiplayerAuthRuntime {
  return freeze({
    authUserRef: bootstrap.authUserRef,
    authProfileRef: bootstrap.authProfileRef,
    authAccessTokenRef: bootstrap.authAccessTokenRef,
    multiplayerIdentityUserIdRef: bootstrap.multiplayerIdentityUserIdRef,
  });
}

export function createNavigationRuntime(
  bootstrap: MultiplayerRuntimeBootstrap,
): MultiplayerNavigationRuntime {
  return freeze({
    appModeRef: bootstrap.appModeRef,
    setAppMode: bootstrap.setAppMode,
  });
}

export function createRoomRuntime(bootstrap: MultiplayerRuntimeBootstrap): MultiplayerRoomRuntime {
  return freeze({
    joinedRoomResponseRef: bootstrap.joinedRoomResponseRef,
    roomIdentityRef: bootstrap.roomIdentityRef,
    youRef: bootstrap.youRef,
    stateRef: bootstrap.stateRef,
    maxSequenceRef: bootstrap.maxSequenceRef,
    roomPlayersRef: bootstrap.roomPlayersRef,
  });
}

export function createGameplayRuntime(
  bootstrap: MultiplayerRuntimeBootstrap,
): MultiplayerGameplayRefsRuntime {
  return freeze({ ...bootstrap.gameplayRefs });
}

export function createControllerRuntime(input: {
  socket: MultiplayerSocketRuntime;
  joinFlight: MultiplayerJoinFlightRuntime;
  reconnect: MultiplayerReconnectRuntime;
  auth: MultiplayerAuthRuntime;
  navigation: MultiplayerNavigationRuntime;
}): ControllerRuntimeSlice {
  return freeze({
    socket: input.socket,
    joinFlight: input.joinFlight,
    reconnect: input.reconnect,
    auth: input.auth,
    navigation: input.navigation,
  });
}

export function createTournamentAttachRuntime(input: {
  bootstrap: MultiplayerRuntimeBootstrap;
  socket: MultiplayerSocketRuntime;
  navigation: MultiplayerNavigationRuntime;
  recovery: MultiplayerRecoveryRuntime;
  session: SessionRuntimeSlice;
}): TournamentAttachRuntime {
  const { bootstrap, socket, navigation, recovery, session } = input;
  return freeze({
    socketRuntime: socket,
    sessionRuntime: { sessionRef: session.sessionRef },
    roomRuntime: { joinedRoomResponseRef: bootstrap.joinedRoomResponseRef },
    reconnectRuntime: {
      preventAutoRejoinRef: bootstrap.preventAutoRejoinRef,
      reconnectShouldJoinRef: bootstrap.reconnectShouldJoinRef,
      reconnectRoomCodeRef: bootstrap.reconnectRoomCodeRef,
    },
    recoveryRuntime: {
      applyJoinedRoomResponseRef: recovery.applyJoinedRoomResponseRef,
      clearRecoverableRoomStateRef: recovery.clearRecoverableRoomStateRef,
      resetMultiplayerRoomStateRef: recovery.resetMultiplayerRoomStateRef,
    },
    navigationRuntime: navigation,
  });
}