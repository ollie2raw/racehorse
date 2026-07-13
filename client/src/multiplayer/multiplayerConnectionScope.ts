import type { MutableRefObject } from 'react';
import type {
  MultiplayerAuthRuntime,
  MultiplayerConnectionConfig,
  MultiplayerConnectionJoinFlightRuntime,
  MultiplayerConnectionNavigationRuntime,
  MultiplayerConnectionReconnectRuntime,
  MultiplayerConnectionRoomRuntime,
  MultiplayerConnectionState,
  MultiplayerConnectionUiSetters,
  MultiplayerSocketRuntime,
} from './runtime/connectionRuntime';
import type { MultiplayerGameplayRefsRuntime } from './runtime/gameplayRuntime';
import type { MultiplayerRecoveryCallbacksRuntime } from './runtime/recoveryRuntime';
import type { MultiplayerRoomSocialRuntime } from './runtime/roomRuntime';
import type { MultiplayerSessionStateRuntime } from './session/sessionRuntimeTypes';
import type { RoomOperationEpochRef } from './roomOperationEpoch';

/**
 * Nested imperative surface for connection transport handlers.
 * Preserves runtime slice ownership instead of re-flattening into a god-bag.
 */
export type MultiplayerConnectionScope = {
  config: MultiplayerConnectionConfig;
  state: MultiplayerConnectionState;
  session: MultiplayerSessionStateRuntime;
  socket: MultiplayerSocketRuntime;
  room: MultiplayerConnectionRoomRuntime;
  reconnect: MultiplayerConnectionReconnectRuntime;
  joinFlight: MultiplayerConnectionJoinFlightRuntime;
  auth: MultiplayerAuthRuntime;
  gameplay: MultiplayerGameplayRefsRuntime & {
    isMutedRef: MutableRefObject<boolean>;
    rematchAwaitingStateRef: MutableRefObject<boolean>;
  };
  recovery: MultiplayerRecoveryCallbacksRuntime;
  social: MultiplayerRoomSocialRuntime;
  ui: MultiplayerConnectionUiSetters;
  navigation: MultiplayerConnectionNavigationRuntime;
  roomOperationEpochRef: RoomOperationEpochRef;
};

export type MultiplayerConnectionScopeSource = {
  config: MultiplayerConnectionConfig;
  connectionState: MultiplayerConnectionState;
  sessionRuntime: MultiplayerSessionStateRuntime;
  socketRuntime: MultiplayerSocketRuntime;
  roomRuntime: MultiplayerConnectionRoomRuntime;
  reconnectRuntime: MultiplayerConnectionReconnectRuntime;
  joinFlightRuntime: MultiplayerConnectionJoinFlightRuntime;
  authRuntime: MultiplayerAuthRuntime;
  gameplayRefsRuntime: MultiplayerConnectionScope['gameplay'];
  recoveryRuntime: MultiplayerRecoveryCallbacksRuntime;
  roomSocialRuntime: MultiplayerRoomSocialRuntime;
  uiSetters: MultiplayerConnectionUiSetters;
  navigationRuntime: MultiplayerConnectionNavigationRuntime;
  roomOperationEpochRef: RoomOperationEpochRef;
};

export function createMultiplayerConnectionScope(
  source: MultiplayerConnectionScopeSource,
): MultiplayerConnectionScope {
  return {
    config: source.config,
    state: source.connectionState,
    session: source.sessionRuntime,
    socket: source.socketRuntime,
    room: source.roomRuntime,
    reconnect: source.reconnectRuntime,
    joinFlight: source.joinFlightRuntime,
    auth: source.authRuntime,
    gameplay: source.gameplayRefsRuntime,
    recovery: source.recoveryRuntime,
    social: source.roomSocialRuntime,
    ui: source.uiSetters,
    navigation: source.navigationRuntime,
    roomOperationEpochRef: source.roomOperationEpochRef,
  };
}
