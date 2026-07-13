import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { RoomChatEvent, RoomEmoteEvent } from './protocol';
import { clearLastRoomCode, LAST_ROOM_STORAGE_KEY } from '../match/recovery/matchRecovery';
import { emitRoomLeave, emitWithAck, type RoomAckResponse } from './roomTransport';
import { useMultiplayerRoomActions } from './useMultiplayerRoomActions';
import type { OutboundChallenge } from './friendChallenge';
import type { RoomPlayer } from './protocol';
import type { FriendInviteState } from './runtime/friendInviteRuntime';
import type {
  MultiplayerReconnectRuntime,
  MultiplayerSocketRuntime,
} from './runtime/connectionRuntime';
import type { MultiplayerNavigationRuntime } from './runtime/navigationRuntime';
import type {
  MultiplayerControllerLobbyActions,
  MultiplayerJoinFlightRuntime,
  MultiplayerRoomActionsAuth,
  MultiplayerRoomActionsTransport,
  MultiplayerRoomActionsUi,
  MultiplayerRoomRuntime,
  MultiplayerRoomSocialRuntime,
} from './runtime/roomRuntime';
import type { MultiplayerSessionStateRuntime } from './session/sessionRuntimeTypes';
import { selectJoinedRoomCode } from './session/sessionStateMachine';
import type { RoomOperationEpochRef } from './roomOperationEpoch';

export type MultiplayerLobbyActionsContextValue = Omit<MultiplayerControllerLobbyActions, 'startGame'> & {
  onCreatePrivateRoom: () => Promise<{ ok: boolean; roomCode: string | null; inviteUrl: string | null }>;
  acceptFriendInvite: () => Promise<void>;
  declineFriendInvite: () => void;
  sendFriendChallenge: ReturnType<typeof useMultiplayerRoomActions>['sendFriendChallenge'];
  spectateRoom: (roomCode: string) => Promise<{ ok: boolean; error?: string }>;
  roomActionsUi: MultiplayerRoomActionsUi;
  roomReactions: Array<RoomChatEvent | RoomEmoteEvent>;
  sendRoomChat: (text: string) => void;
  sendRoomEmote: (emote: string) => void;
};

const MultiplayerLobbyActionsContext = createContext<MultiplayerLobbyActionsContextValue | null>(null);

/** Stable ref bridge created in App before useMultiplayerConnection; populated by the lobby host. */
export function useMultiplayerRoomSocialRuntimeBridge(): MultiplayerRoomSocialRuntime {
  const appendRoomReactionRef = useRef<(item: RoomChatEvent | RoomEmoteEvent) => void>(() => {});
  const clearRoomReactionsRef = useRef<() => void>(() => {});
  return useMemo(
    (): MultiplayerRoomSocialRuntime => ({
      appendRoomReactionRef,
      clearRoomReactionsRef,
    }),
    [],
  );
}

export function useMultiplayerLobbyActionsContext(): MultiplayerLobbyActionsContextValue {
  const value = useContext(MultiplayerLobbyActionsContext);
  if (!value) {
    throw new Error('useMultiplayerLobbyActionsContext must be used within MultiplayerLobbyActionsHost');
  }
  return value;
}

export type MultiplayerLobbyActionsHostProps = {
  socket: Socket | null;
  socketRuntime: MultiplayerSocketRuntime;
  roomRuntime: Pick<MultiplayerRoomRuntime, 'roomIdentityRef'>;
  sessionRuntime: MultiplayerSessionStateRuntime;
  joinFlightRuntime: MultiplayerJoinFlightRuntime;
  reconnectRuntime: Pick<
    MultiplayerReconnectRuntime,
    'reconnectRoomCodeRef' | 'reconnectShouldJoinRef' | 'preventAutoRejoinRef'
  >;
  navigationRuntime: MultiplayerNavigationRuntime;
  roomSocialRuntime: MultiplayerRoomSocialRuntime;
  roomCode: string;
  joinedRoom: string | null;
  friendInvite: FriendInviteState;
  outboundChallenge: OutboundChallenge | null;
  applyJoinedRoomResponse: (resp: RoomAckResponse) => void;
  emitCreateRoom: (targetSocket: Socket) => Promise<RoomAckResponse>;
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
  reconnectAttemptCountRef: MutableRefObject<number>;
  rejoinInFlightRef: MutableRefObject<boolean>;
  autoJoinAttemptedRef: MutableRefObject<boolean>;
  roomOperationEpochRef: RoomOperationEpochRef;
};

function useMultiplayerLobbyController(props: MultiplayerLobbyActionsHostProps) {
  const [roomReactions, setRoomReactions] = useState<Array<RoomChatEvent | RoomEmoteEvent>>([]);

  const authUsernameRef = useRef(props.authProfile?.username ?? 'Guest');
  const authUserIdRef = useRef<string | null>(props.multiplayerIdentityUserId);
  const authTokenRef = useRef<string | null>(props.multiplayerAuthToken);

  useEffect(() => {
    authUsernameRef.current = props.authProfile?.username ?? 'Guest';
    authUserIdRef.current = props.multiplayerIdentityUserId;
    authTokenRef.current = props.multiplayerAuthToken;
  }, [props.authProfile?.username, props.multiplayerIdentityUserId, props.multiplayerAuthToken]);

  const roomActionsTransport = useMemo(
    (): MultiplayerRoomActionsTransport => ({
      normalizeRoomCode: props.normalizeRoomCode,
      normalizeRoomPlayers: props.normalizeRoomPlayers,
      emitWithAck,
      emitCreateRoom: props.emitCreateRoom,
      getInviteLink: props.getInviteLink,
      resolvePendingCreate: props.resolvePendingCreate,
      lastRoomStorageKey: LAST_ROOM_STORAGE_KEY,
    }),
    [props.emitCreateRoom, props.getInviteLink, props.normalizeRoomCode, props.normalizeRoomPlayers, props.resolvePendingCreate],
  );

  const roomActionsAuth = useMemo(
    (): MultiplayerRoomActionsAuth => ({
      authUsername: props.authProfile?.username ?? 'Guest',
      authUserId: props.multiplayerIdentityUserId,
      authToken: props.multiplayerAuthToken,
      authUsernameRef,
      authUserIdRef,
      authTokenRef,
    }),
    [props.authProfile?.username, props.multiplayerAuthToken, props.multiplayerIdentityUserId],
  );

  const roomActionsUi = useMemo(
    (): MultiplayerRoomActionsUi => ({
      showToast: props.showToast,
      setRoomCode: props.setRoomCode,
      setPlayers: props.setPlayers,
      setError: props.setError,
      setActionError: props.setActionError,
      setPendingUiAction: props.setPendingUiAction,
      setRoomRecoveryState: props.setRoomRecoveryState,
      setRoomRecoveryMessage: props.setRoomRecoveryMessage,
      setFriendInvite: props.setFriendInvite,
      setMpSubView: props.setMpSubView,
      setOutboundChallenge: props.setOutboundChallenge,
    }),
    [
      props.setActionError,
      props.setError,
      props.setFriendInvite,
      props.setMpSubView,
      props.setOutboundChallenge,
      props.setPendingUiAction,
      props.setPlayers,
      props.setRoomCode,
      props.setRoomRecoveryMessage,
      props.setRoomRecoveryState,
      props.showToast,
    ],
  );

  const roomActions = useMultiplayerRoomActions({
    socket: props.socket,
    socketRuntime: props.socketRuntime,
    sessionRuntime: props.sessionRuntime,
    roomRuntime: props.roomRuntime,
    joinFlightRuntime: props.joinFlightRuntime,
    reconnectRuntime: props.reconnectRuntime,
    navigationRuntime: props.navigationRuntime,
    transport: roomActionsTransport,
    auth: roomActionsAuth,
    ui: roomActionsUi,
    roomCode: props.roomCode,
    friendInvite: props.friendInvite,
    outboundChallenge: props.outboundChallenge,
    applyJoinedRoomResponse: props.applyJoinedRoomResponse,
    roomOperationEpochRef: props.roomOperationEpochRef,
  });

  const appendRoomReaction = useCallback((item: RoomChatEvent | RoomEmoteEvent) => {
    setRoomReactions((prev) => {
      const next = prev.concat(item);
      return next.length > 50 ? next.slice(next.length - 50) : next;
    });
  }, []);

  const clearRoomReactions = useCallback(() => {
    setRoomReactions([]);
  }, []);

  useEffect(() => {
    const appendRoomReactionRef = props.roomSocialRuntime.appendRoomReactionRef;
    const clearRoomReactionsRef = props.roomSocialRuntime.clearRoomReactionsRef;
    appendRoomReactionRef.current = appendRoomReaction;
    clearRoomReactionsRef.current = clearRoomReactions;
  }, [appendRoomReaction, clearRoomReactions, props.roomSocialRuntime]);

  const leavePrivateLobbyRoom = useCallback(() => {
    const code = props.normalizeRoomCode(
      selectJoinedRoomCode(props.sessionRuntime.sessionRef.current),
    );
    const s = props.socketRuntime.socketRef.current;
    if (s?.connected && code) {
      emitRoomLeave(s, code);
    }
    clearLastRoomCode();
    const reconnectShouldJoinRef = props.reconnectRuntime.reconnectShouldJoinRef;
    const reconnectRoomCodeRef = props.reconnectRuntime.reconnectRoomCodeRef;
    const preventAutoRejoinRef = props.reconnectRuntime.preventAutoRejoinRef;
    props.sessionRuntime.dispatchSession({ type: 'INTENTIONAL_DISCONNECT', value: false });
    reconnectShouldJoinRef.current = false;
    reconnectRoomCodeRef.current = null;
    props.clearReconnectAttemptTimer();
    const reconnectAttemptCountRef = props.reconnectAttemptCountRef;
    const rejoinInFlightRef = props.rejoinInFlightRef;
    const autoJoinAttemptedRef = props.autoJoinAttemptedRef;
    reconnectAttemptCountRef.current = 0;
    rejoinInFlightRef.current = false;
    preventAutoRejoinRef.current = false;
    autoJoinAttemptedRef.current = false;
    props.setIsRecoveringConnection(false);
    props.setRoomRecoveryState('idle');
    props.setRoomRecoveryMessage('');
    clearRoomReactions();
    props.resetMultiplayerRoomState({ clearRoomCode: true });
    props.clearOutboundChallenge();
    props.setMpSubView('private');
  }, [clearRoomReactions, props]);

  const copyRoomCodeToClipboard = useCallback(async () => {
    const code = props.normalizeRoomCode(props.joinedRoom || props.roomCode);
    if (!code) {
      props.showToast('No room code to copy.');
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      props.showToast('Room code copied.');
    } catch {
      props.showToast('Could not copy room code.');
    }
  }, [props]);

  const sendRoomChat = useCallback(
    (text: string) => {
      const t = String(text ?? '').trim();
      if (!t) return;

      appendRoomReaction({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        t: Date.now(),
        from: { userId: null, username: 'you' },
        text: t,
      });

      if (!props.socket) return;
      props.socket.emit('room:chat:send', { text: t });
    },
    [appendRoomReaction, props.socket],
  );

  const sendRoomEmote = useCallback(
    (emote: string) => {
      const e = String(emote ?? '').trim();
      if (!e) return;

      appendRoomReaction({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        t: Date.now(),
        from: { userId: null, username: 'you' },
        emote: e,
      });

      if (!props.socket) return;
      props.socket.emit('room:emote:send', { emote: e });
    },
    [appendRoomReaction, props.socket],
  );

  return {
    ...roomActions,
    leavePrivateLobbyRoom,
    copyRoomCodeToClipboard,
    roomActionsUi,
    roomReactions,
    sendRoomChat,
    sendRoomEmote,
  };
}

export function MultiplayerLobbyActionsHost({
  children,
  ...props
}: MultiplayerLobbyActionsHostProps & { children?: ReactNode }) {
  const lobby = useMultiplayerLobbyController(props);

  const contextValue = useMemo(
    (): MultiplayerLobbyActionsContextValue => ({
      onCreatePrivateRoom: lobby.onCreatePrivateRoom,
      copyInviteLink: lobby.copyInviteLink,
      createRoom: lobby.createRoom,
      joinRoom: lobby.joinRoom,
      leavePrivateLobbyRoom: lobby.leavePrivateLobbyRoom,
      copyRoomCodeToClipboard: lobby.copyRoomCodeToClipboard,
      acceptFriendInvite: lobby.acceptFriendInvite,
      declineFriendInvite: lobby.declineFriendInvite,
      sendFriendChallenge: lobby.sendFriendChallenge,
      spectateRoom: lobby.spectateRoom,
      roomActionsUi: lobby.roomActionsUi,
      roomReactions: lobby.roomReactions,
      sendRoomChat: lobby.sendRoomChat,
      sendRoomEmote: lobby.sendRoomEmote,
    }),
    [lobby],
  );

  return createElement(MultiplayerLobbyActionsContext.Provider, { value: contextValue }, children);
}
