import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { GameState } from '../../types';
import type { RoomChatEvent, RoomEmoteEvent, RoomIdentity, RoomPlayer, RoomRecoveryState } from '../protocol';
import type { PrivateRoomCreateSettings, RoomAckResponse } from '../roomTransport';
import type { FriendInviteState } from './friendInviteRuntime';

/** Room identity, sequence tracking, and lobby refs. Joined room code lives on session FSM. */
export type MultiplayerRoomRuntime = {
  joinedRoomResponseRef: MutableRefObject<unknown>;
  roomIdentityRef: MutableRefObject<RoomIdentity | null>;
  youRef: MutableRefObject<string>;
  stateRef: MutableRefObject<GameState | null>;
  maxSequenceRef: MutableRefObject<number>;
  roomPlayersRef: MutableRefObject<RoomPlayer[]>;
};

/** In-flight guards for room create/join/invite operations. */
export type MultiplayerJoinFlightRuntime = {
  pendingCreateOnConnectRef: MutableRefObject<boolean>;
  pendingCreateResolversRef: MutableRefObject<Array<(code: string | null) => void>>;
  autoJoinAttemptedRef: MutableRefObject<boolean>;
  joinInFlightRef: MutableRefObject<boolean>;
  createInFlightRef: MutableRefObject<boolean>;
  inviteJoinInFlightRef: MutableRefObject<boolean>;
  autoConnectAttemptedRef: MutableRefObject<boolean>;
};

/** Ref bridge so App-level connection handlers can append/clear lobby-owned room reactions. */
export type MultiplayerRoomSocialRuntime = {
  appendRoomReactionRef: MutableRefObject<(item: RoomChatEvent | RoomEmoteEvent) => void>;
  clearRoomReactionsRef: MutableRefObject<() => void>;
};

export type MultiplayerRoomActionsTransport = {
  normalizeRoomCode: (value: unknown) => string;
  normalizeRoomPlayers: (value: unknown) => RoomPlayer[];
  emitWithAck: <TResp>(
    socket: { emit: (event: string, ...args: unknown[]) => void },
    event: string,
    ...argsWithoutAck: unknown[]
  ) => Promise<TResp>;
  emitCreateRoom: (
    targetSocket: Socket,
    settings?: PrivateRoomCreateSettings,
  ) => Promise<RoomAckResponse>;
  getInviteLink: (code: string) => string;
  resolvePendingCreate: (code: string | null) => void;
  lastRoomStorageKey: string;
};

export type MultiplayerRoomActionsAuth = {
  authUsername: string;
  authUserId: string | null;
  authToken: string | null;
  authUsernameRef: MutableRefObject<string>;
  authUserIdRef: MutableRefObject<string | null>;
  authTokenRef: MutableRefObject<string | null>;
};

export type MultiplayerRoomActionsUi = {
  showToast: (message: string, duration?: number) => void;
  setRoomCode: Dispatch<SetStateAction<string>>;
  setPlayers: Dispatch<SetStateAction<RoomPlayer[]>>;
  setError: Dispatch<SetStateAction<string>>;
  setActionError: Dispatch<SetStateAction<string>>;
  setPendingUiAction: Dispatch<
    SetStateAction<null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play'>
  >;
  setRoomRecoveryState: Dispatch<SetStateAction<RoomRecoveryState>>;
  setRoomRecoveryMessage: Dispatch<SetStateAction<string>>;
  setFriendInvite: Dispatch<SetStateAction<FriendInviteState>>;
  setMpSubView: Dispatch<SetStateAction<'quick' | 'private'>>;
  setOutboundChallenge: Dispatch<SetStateAction<import('../friendChallenge').OutboundChallenge | null>>;
};

export type MultiplayerLiveMatchRoomRuntime = Pick<
  MultiplayerRoomRuntime,
  'maxSequenceRef' | 'roomPlayersRef'
>;

/** Lobby callbacks from useMultiplayerRoomActions (not the full hook transport/auth bundles). */
export type MultiplayerControllerLobbyActions = {
  createRoom: (settings?: PrivateRoomCreateSettings) => void;
  joinRoom: () => void;
  leavePrivateLobbyRoom: () => void;
  startGame: () => void;
  copyInviteLink: () => Promise<{ ok: boolean; roomCode: string | null; inviteUrl: string | null }>;
  copyRoomCodeToClipboard: () => void;
};

/** Live lobby snapshot for MultiplayerModeController render (roomCode lives on connectionState). */
export type MultiplayerControllerLobbySnapshot = {
  joinedRoom: string | null;
  you: string;
  players: RoomPlayer[];
  isRoomHost: boolean;
  pendingUiAction: null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play';
  privateLobbyHostWinStreak: number | null;
  outboundChallenge: import('../friendChallenge').OutboundChallenge | null;
  lobbyError?: string;
};