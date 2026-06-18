import { useMemo } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { GameState } from './types';
import type { AppMode } from './appRouteTypes';
import type { RoomAckResponse } from './multiplayer/roomTransport';
import type {
  MultiplayerAuthRuntime,
  MultiplayerJoinFlightRuntime,
  MultiplayerNavigationRuntime,
  MultiplayerReconnectRuntime,
  MultiplayerRoomRuntime,
  MultiplayerSocketRuntime,
  TournamentAttachRuntime,
} from './multiplayer/multiplayerRuntime';

export type UseAppSessionRuntimeSource = {
  socketRef: MutableRefObject<Socket | null>;
  connectRef: MutableRefObject<() => void>;
  pendingCreateOnConnectRef: MutableRefObject<boolean>;
  pendingCreateResolversRef: MutableRefObject<Array<(code: string | null) => void>>;
  autoJoinAttemptedRef: MutableRefObject<boolean>;
  joinInFlightRef: MutableRefObject<boolean>;
  createInFlightRef: MutableRefObject<boolean>;
  inviteJoinInFlightRef: MutableRefObject<boolean>;
  autoConnectAttemptedRef: MutableRefObject<boolean>;
  reconnectRoomCodeRef: MutableRefObject<string | null>;
  reconnectShouldJoinRef: MutableRefObject<boolean>;
  preventAutoRejoinRef: MutableRefObject<boolean>;
  reconnectAttemptTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  reconnectAttemptCountRef: MutableRefObject<number>;
  intentionalDisconnectRef: MutableRefObject<boolean>;
  rejoinInFlightRef: MutableRefObject<boolean>;
  authUserRef: MutableRefObject<{ id?: string | null; email?: string | null } | null>;
  authProfileRef: MutableRefObject<{ username?: string | null } | null>;
  authAccessTokenRef: MutableRefObject<string | null>;
  multiplayerIdentityUserIdRef: MutableRefObject<string | null>;
  appModeRef: MutableRefObject<AppMode>;
  setAppMode: Dispatch<SetStateAction<AppMode>>;
  joinedRoomRef: MutableRefObject<string | null>;
  joinedRoomResponseRef: MutableRefObject<RoomAckResponse | null>;
  roomIdentityRef: MutableRefObject<{
    username: string;
    userId: string | null;
    authToken: string | null;
  } | null>;
  youRef: MutableRefObject<string>;
  stateRef: MutableRefObject<GameState | null>;
  maxSequenceRef: MutableRefObject<number>;
  roomPlayersRef: MutableRefObject<
    Array<{ id: string; username: string; userId: string | null }>
  >;
  applyJoinedRoomResponseRef: MutableRefObject<(resp: RoomAckResponse) => void>;
  clearRecoverableRoomStateRef: MutableRefObject<() => void>;
  resetMultiplayerRoomStateRef: MutableRefObject<
    (options?: { keepPlayers?: boolean; clearRoomCode?: boolean }) => void
  >;
};

export type UseAppSessionRuntimeResult = {
  socketRuntime: MultiplayerSocketRuntime;
  joinFlightRuntime: MultiplayerJoinFlightRuntime;
  reconnectRuntime: MultiplayerReconnectRuntime;
  authRuntime: MultiplayerAuthRuntime;
  navigationRuntime: MultiplayerNavigationRuntime;
  roomRuntime: MultiplayerRoomRuntime;
  tournamentAttachRuntime: TournamentAttachRuntime;
};

export function useAppSessionRuntime(source: UseAppSessionRuntimeSource): UseAppSessionRuntimeResult {
  const socketRuntime = useMemo(
    (): MultiplayerSocketRuntime => ({
      socketRef: source.socketRef,
      connectRef: source.connectRef,
    }),
    [],
  );

  const joinFlightRuntime = useMemo(
    (): MultiplayerJoinFlightRuntime => ({
      pendingCreateOnConnectRef: source.pendingCreateOnConnectRef,
      pendingCreateResolversRef: source.pendingCreateResolversRef,
      autoJoinAttemptedRef: source.autoJoinAttemptedRef,
      joinInFlightRef: source.joinInFlightRef,
      createInFlightRef: source.createInFlightRef,
      inviteJoinInFlightRef: source.inviteJoinInFlightRef,
      autoConnectAttemptedRef: source.autoConnectAttemptedRef,
    }),
    [],
  );

  const reconnectRuntime = useMemo(
    (): MultiplayerReconnectRuntime => ({
      reconnectRoomCodeRef: source.reconnectRoomCodeRef,
      reconnectShouldJoinRef: source.reconnectShouldJoinRef,
      preventAutoRejoinRef: source.preventAutoRejoinRef,
      reconnectAttemptTimerRef: source.reconnectAttemptTimerRef,
      reconnectAttemptCountRef: source.reconnectAttemptCountRef,
      intentionalDisconnectRef: source.intentionalDisconnectRef,
      rejoinInFlightRef: source.rejoinInFlightRef,
    }),
    [],
  );

  const authRuntime = useMemo(
    (): MultiplayerAuthRuntime => ({
      authUserRef: source.authUserRef,
      authProfileRef: source.authProfileRef,
      authAccessTokenRef: source.authAccessTokenRef,
      multiplayerIdentityUserIdRef: source.multiplayerIdentityUserIdRef,
    }),
    [],
  );

  const navigationRuntime = useMemo(
    (): MultiplayerNavigationRuntime => ({
      appModeRef: source.appModeRef,
      setAppMode: source.setAppMode,
    }),
    [],
  );

  const roomRuntime = useMemo(
    (): MultiplayerRoomRuntime => ({
      joinedRoomRef: source.joinedRoomRef,
      joinedRoomResponseRef: source.joinedRoomResponseRef,
      roomIdentityRef: source.roomIdentityRef,
      youRef: source.youRef,
      stateRef: source.stateRef,
      maxSequenceRef: source.maxSequenceRef,
      roomPlayersRef: source.roomPlayersRef,
    }),
    [source.stateRef, source.youRef],
  );

  const tournamentAttachRuntime = useMemo(
    (): TournamentAttachRuntime => ({
      socketRuntime,
      roomRuntime: {
        joinedRoomRef: source.joinedRoomRef,
        joinedRoomResponseRef: source.joinedRoomResponseRef,
      },
      reconnectRuntime: {
        preventAutoRejoinRef: source.preventAutoRejoinRef,
        reconnectShouldJoinRef: source.reconnectShouldJoinRef,
        reconnectRoomCodeRef: source.reconnectRoomCodeRef,
      },
      recoveryRuntime: {
        applyJoinedRoomResponseRef: source.applyJoinedRoomResponseRef,
        clearRecoverableRoomStateRef: source.clearRecoverableRoomStateRef,
        resetMultiplayerRoomStateRef: source.resetMultiplayerRoomStateRef,
      },
      navigationRuntime,
    }),
    [navigationRuntime, socketRuntime],
  );

  return {
    socketRuntime,
    joinFlightRuntime,
    reconnectRuntime,
    authRuntime,
    navigationRuntime,
    roomRuntime,
    tournamentAttachRuntime,
  };
}
