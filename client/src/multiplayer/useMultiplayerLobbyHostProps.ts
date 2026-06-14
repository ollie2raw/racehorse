import { useMemo } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { OutboundChallenge } from './friendChallenge';
import type {
  MultiplayerJoinFlightRuntime,
  MultiplayerNavigationRuntime,
  MultiplayerReconnectRuntime,
  MultiplayerRoomRuntime,
  MultiplayerRoomSocialRuntime,
  MultiplayerSocketRuntime,
  FriendInviteState,
} from './multiplayerRuntime';
import type { MultiplayerLobbyActionsHostProps } from './useMultiplayerLobbyController';

type RoomPlayer = { id: string; username: string; userId: string | null };

export type UseMultiplayerLobbyHostPropsSource = {
  socket: Socket | null;
  socketRuntime: MultiplayerSocketRuntime;
  roomRuntime: MultiplayerRoomRuntime;
  joinFlightRuntime: MultiplayerJoinFlightRuntime;
  reconnectRuntime: MultiplayerReconnectRuntime;
  navigationRuntime: MultiplayerNavigationRuntime;
  roomSocialRuntime: MultiplayerRoomSocialRuntime;
  roomCode: string;
  joinedRoom: string | null;
  friendInvite: FriendInviteState;
  outboundChallenge: OutboundChallenge | null;
  applyJoinedRoomResponse: (resp: unknown) => void;
  emitCreateRoom: (targetSocket: Socket) => Promise<unknown>;
  showToast: (message: string, duration?: number) => void;
  normalizeRoomCode: (value: unknown) => string;
  normalizeRoomPlayers: (value: unknown) => RoomPlayer[];
  getInviteLink: (code: string) => string;
  resolvePendingCreate: (code: string | null) => void;
  clearReconnectAttemptTimer: () => void;
  clearOutboundChallenge: () => void;
  resetMultiplayerRoomState: (options?: { keepPlayers?: boolean; clearRoomCode?: boolean }) => void;
  setIsRecoveringConnection: Dispatch<SetStateAction<boolean>>;
  authProfile: { username?: string | null } | null;
  multiplayerIdentityUserId: string | null;
  multiplayerAuthToken: string | null;
  setRoomCode: Dispatch<SetStateAction<string>>;
  setPlayers: Dispatch<SetStateAction<RoomPlayer[]>>;
  setError: Dispatch<SetStateAction<string>>;
  setActionError: Dispatch<SetStateAction<string>>;
  setPendingUiAction: Dispatch<
    SetStateAction<null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play'>
  >;
  setRoomRecoveryState: Dispatch<SetStateAction<'idle' | 'reconnecting' | 'resyncing' | 'failed'>>;
  setRoomRecoveryMessage: Dispatch<SetStateAction<string>>;
  setFriendInvite: Dispatch<SetStateAction<FriendInviteState>>;
  setMpSubView: Dispatch<SetStateAction<'quick' | 'private'>>;
  setOutboundChallenge: Dispatch<SetStateAction<OutboundChallenge | null>>;
  intentionalDisconnectRef: MutableRefObject<boolean>;
  reconnectAttemptCountRef: MutableRefObject<number>;
  rejoinInFlightRef: MutableRefObject<boolean>;
  autoJoinAttemptedRef: MutableRefObject<boolean>;
};

export function useMultiplayerLobbyHostProps(
  source: UseMultiplayerLobbyHostPropsSource,
): MultiplayerLobbyActionsHostProps {
  return useMemo(
    (): MultiplayerLobbyActionsHostProps => ({
      socket: source.socket,
      socketRuntime: source.socketRuntime,
      roomRuntime: {
        joinedRoomRef: source.roomRuntime.joinedRoomRef,
        roomIdentityRef: source.roomRuntime.roomIdentityRef,
      },
      joinFlightRuntime: source.joinFlightRuntime,
      reconnectRuntime: {
        reconnectRoomCodeRef: source.reconnectRuntime.reconnectRoomCodeRef,
        reconnectShouldJoinRef: source.reconnectRuntime.reconnectShouldJoinRef,
        preventAutoRejoinRef: source.reconnectRuntime.preventAutoRejoinRef,
      },
      navigationRuntime: source.navigationRuntime,
      roomSocialRuntime: source.roomSocialRuntime,
      roomCode: source.roomCode,
      joinedRoom: source.joinedRoom,
      friendInvite: source.friendInvite,
      outboundChallenge: source.outboundChallenge,
      applyJoinedRoomResponse: source.applyJoinedRoomResponse,
      emitCreateRoom: source.emitCreateRoom,
      showToast: source.showToast,
      normalizeRoomCode: source.normalizeRoomCode,
      normalizeRoomPlayers: source.normalizeRoomPlayers,
      getInviteLink: source.getInviteLink,
      resolvePendingCreate: source.resolvePendingCreate,
      clearReconnectAttemptTimer: source.clearReconnectAttemptTimer,
      clearOutboundChallenge: source.clearOutboundChallenge,
      resetMultiplayerRoomState: source.resetMultiplayerRoomState,
      setIsRecoveringConnection: source.setIsRecoveringConnection,
      authProfile: source.authProfile,
      multiplayerIdentityUserId: source.multiplayerIdentityUserId,
      multiplayerAuthToken: source.multiplayerAuthToken,
      setRoomCode: source.setRoomCode,
      setPlayers: source.setPlayers,
      setError: source.setError,
      setActionError: source.setActionError,
      setPendingUiAction: source.setPendingUiAction,
      setRoomRecoveryState: source.setRoomRecoveryState,
      setRoomRecoveryMessage: source.setRoomRecoveryMessage,
      setFriendInvite: source.setFriendInvite,
      setMpSubView: source.setMpSubView,
      setOutboundChallenge: source.setOutboundChallenge,
      intentionalDisconnectRef: source.intentionalDisconnectRef,
      reconnectAttemptCountRef: source.reconnectAttemptCountRef,
      rejoinInFlightRef: source.rejoinInFlightRef,
      autoJoinAttemptedRef: source.autoJoinAttemptedRef,
    }),
    [
      source.socket,
      source.socketRuntime,
      source.roomRuntime.joinedRoomRef,
      source.roomRuntime.roomIdentityRef,
      source.joinFlightRuntime,
      source.reconnectRuntime.reconnectRoomCodeRef,
      source.reconnectRuntime.reconnectShouldJoinRef,
      source.reconnectRuntime.preventAutoRejoinRef,
      source.navigationRuntime,
      source.roomSocialRuntime,
      source.roomCode,
      source.joinedRoom,
      source.friendInvite,
      source.outboundChallenge,
      source.applyJoinedRoomResponse,
      source.emitCreateRoom,
      source.showToast,
      source.getInviteLink,
      source.resolvePendingCreate,
      source.clearReconnectAttemptTimer,
      source.clearOutboundChallenge,
      source.resetMultiplayerRoomState,
      source.authProfile,
      source.multiplayerIdentityUserId,
      source.multiplayerAuthToken,
    ],
  );
}
