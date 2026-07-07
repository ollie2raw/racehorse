import type { Socket } from 'socket.io-client';
import type { OutboundChallenge } from './friendChallenge';
import type { RoomAckResponse } from './roomTransport';
import type {
  MultiplayerReconnectRuntime,
  MultiplayerSocketRuntime,
} from './runtime/connectionRuntime';
import type { MultiplayerNavigationRuntime } from './runtime/navigationRuntime';
import type { FriendInviteState } from './runtime/friendInviteRuntime';
import type {
  MultiplayerJoinFlightRuntime,
  MultiplayerRoomActionsAuth,
  MultiplayerRoomActionsTransport,
  MultiplayerRoomActionsUi,
  MultiplayerRoomRuntime,
} from './runtime/roomRuntime';
import type { MultiplayerSessionStateRuntime } from './session/sessionRuntimeTypes';

/**
 * Nested imperative surface for room action handlers.
 * Preserves runtime slice ownership instead of re-flattening into a god-bag.
 */
export type MultiplayerRoomActionsScope = {
  transport: MultiplayerSocketRuntime &
    MultiplayerRoomActionsTransport & {
      socket: Socket | null;
    };
  session: Pick<MultiplayerSessionStateRuntime, 'sessionRef'>;
  room: Pick<MultiplayerRoomRuntime, 'roomIdentityRef'> & {
    roomCode: string;
    applyJoinedRoomResponse: (resp: RoomAckResponse) => void;
  };
  joinFlight: MultiplayerJoinFlightRuntime;
  reconnect: Pick<
    MultiplayerReconnectRuntime,
    'reconnectRoomCodeRef' | 'reconnectShouldJoinRef' | 'preventAutoRejoinRef'
  >;
  navigation: MultiplayerNavigationRuntime;
  auth: MultiplayerRoomActionsAuth;
  ui: MultiplayerRoomActionsUi & {
    friendInvite: FriendInviteState;
    outboundChallenge: OutboundChallenge | null;
  };
};

export type MultiplayerRoomActionsScopeSource = {
  socket: Socket | null;
  socketRuntime: MultiplayerSocketRuntime;
  sessionRuntime: Pick<MultiplayerSessionStateRuntime, 'sessionRef'>;
  roomRuntime: Pick<MultiplayerRoomRuntime, 'roomIdentityRef'>;
  joinFlightRuntime: MultiplayerJoinFlightRuntime;
  reconnectRuntime: Pick<
    MultiplayerReconnectRuntime,
    'reconnectRoomCodeRef' | 'reconnectShouldJoinRef' | 'preventAutoRejoinRef'
  >;
  navigationRuntime: MultiplayerNavigationRuntime;
  transport: MultiplayerRoomActionsTransport;
  auth: MultiplayerRoomActionsAuth;
  ui: MultiplayerRoomActionsUi;
  roomCode: string;
  friendInvite: FriendInviteState;
  outboundChallenge: OutboundChallenge | null;
  applyJoinedRoomResponse: (resp: RoomAckResponse) => void;
};

export function createMultiplayerRoomActionsScope(
  source: MultiplayerRoomActionsScopeSource,
): MultiplayerRoomActionsScope {
  return {
    transport: {
      socket: source.socket,
      ...source.socketRuntime,
      ...source.transport,
    },
    session: source.sessionRuntime,
    room: {
      ...source.roomRuntime,
      roomCode: source.roomCode,
      applyJoinedRoomResponse: source.applyJoinedRoomResponse,
    },
    joinFlight: source.joinFlightRuntime,
    reconnect: source.reconnectRuntime,
    navigation: source.navigationRuntime,
    auth: source.auth,
    ui: {
      ...source.ui,
      friendInvite: source.friendInvite,
      outboundChallenge: source.outboundChallenge,
    },
  };
}