import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import {
  FRIEND_CHALLENGE_EXPIRY_MS,
  FRIEND_CHALLENGE_MATCH_SUMMARY,
  makeFriendChallengeInviteId,
  type FriendChallengeTarget,
  type OutboundChallenge,
  type SendFriendChallengeResult,
} from './friendChallenge';
import type { PrivateRoomCreateSettings } from './roomTransport';
import type {
  FriendInviteState,
  MultiplayerJoinFlightRuntime,
  MultiplayerNavigationRuntime,
  MultiplayerReconnectRuntime,
  MultiplayerRoomActionsAuth,
  MultiplayerRoomActionsTransport,
  MultiplayerRoomActionsUi,
  MultiplayerRoomRuntime,
  MultiplayerSocketRuntime,
} from './multiplayerRuntime';

type PendingUiAction = null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play';

type RoomJoinConfig = {
  username: string;
  userId: string | null;
  authToken: string | null;
};

export type UseMultiplayerRoomActionsParams = {
  socket: Socket | null;
  socketRuntime: MultiplayerSocketRuntime;
  roomRuntime: Pick<MultiplayerRoomRuntime, 'joinedRoomRef' | 'roomIdentityRef'>;
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
  applyJoinedRoomResponse: (resp: unknown) => void;
};

type FlatMultiplayerRoomActionsParams = {
  socket: Socket | null;
  socketRef: MutableRefObject<Socket | null>;
  connectRef: MutableRefObject<() => void>;
  joinedRoomRef: MutableRefObject<string | null>;
  pendingCreateOnConnectRef: MutableRefObject<boolean>;
  pendingCreateResolversRef: MutableRefObject<Array<(code: string | null) => void>>;
  autoJoinAttemptedRef: MutableRefObject<boolean>;
  preventAutoRejoinRef: MutableRefObject<boolean>;
  joinInFlightRef: MutableRefObject<boolean>;
  createInFlightRef: MutableRefObject<boolean>;
  inviteJoinInFlightRef: MutableRefObject<boolean>;
  reconnectRoomCodeRef: MutableRefObject<string | null>;
  reconnectShouldJoinRef: MutableRefObject<boolean>;
  roomCode: string;
  friendInvite: FriendInviteState;
  authUsername: string;
  authUserId: string | null;
  authToken: string | null;
  authUsernameRef: MutableRefObject<string>;
  authUserIdRef: MutableRefObject<string | null>;
  authTokenRef: MutableRefObject<string | null>;
  normalizeRoomCode: (value: unknown) => string;
  normalizeRoomPlayers: (value: unknown) => any[];
  emitWithAck: MultiplayerRoomActionsTransport['emitWithAck'];
  emitCreateRoom: (
    targetSocket: Socket,
    settings?: PrivateRoomCreateSettings,
  ) => Promise<any>;
  getInviteLink: (code: string) => string;
  resolvePendingCreate: (code: string | null) => void;
  applyJoinedRoomResponse: (resp: any) => void;
  showToast: (message: string, duration?: number) => void;
  setAppMode: MultiplayerNavigationRuntime['setAppMode'];
  setRoomCode: Dispatch<SetStateAction<string>>;
  setPlayers: Dispatch<SetStateAction<any[]>>;
  setError: Dispatch<SetStateAction<string>>;
  setActionError: Dispatch<SetStateAction<string>>;
  setPendingUiAction: Dispatch<SetStateAction<PendingUiAction>>;
  setRoomRecoveryState: Dispatch<SetStateAction<'idle' | 'reconnecting' | 'resyncing' | 'failed'>>;
  setRoomRecoveryMessage: Dispatch<SetStateAction<string>>;
  setFriendInvite: Dispatch<SetStateAction<FriendInviteState>>;
  setMpSubView: Dispatch<SetStateAction<'quick' | 'private'>>;
  outboundChallenge: OutboundChallenge | null;
  setOutboundChallenge: Dispatch<SetStateAction<OutboundChallenge | null>>;
  roomIdentityRef: MutableRefObject<{
    username: string;
    userId: string | null;
    authToken: string | null;
  } | null>;
  lastRoomStorageKey: string;
};

function flattenMultiplayerRoomActionsParams(
  params: UseMultiplayerRoomActionsParams,
): FlatMultiplayerRoomActionsParams {
  return {
    socket: params.socket,
    ...params.socketRuntime,
    joinedRoomRef: params.roomRuntime.joinedRoomRef,
    roomIdentityRef: params.roomRuntime.roomIdentityRef,
    ...params.joinFlightRuntime,
    ...params.reconnectRuntime,
    roomCode: params.roomCode,
    friendInvite: params.friendInvite,
    outboundChallenge: params.outboundChallenge,
    applyJoinedRoomResponse: params.applyJoinedRoomResponse,
    ...params.auth,
    ...params.transport,
    ...params.ui,
    setAppMode: params.navigationRuntime.setAppMode,
  };
}

export function useMultiplayerRoomActions(inputParams: UseMultiplayerRoomActionsParams) {
  const flatParamsRef = useRef(flattenMultiplayerRoomActionsParams(inputParams));
  flatParamsRef.current = flattenMultiplayerRoomActionsParams(inputParams);
  const params = flatParamsRef.current;
  const roomJoinConfig = useCallback(
    (): RoomJoinConfig =>
      params.roomIdentityRef.current ?? {
        username: params.authUsername,
        userId: params.authUserId,
        authToken: params.authToken,
      },
    [params.authUsername, params.authUserId, params.authToken, params.roomIdentityRef],
  );

  const onCreatePrivateRoom = useCallback(async (): Promise<{
    ok: boolean;
    roomCode: string | null;
    inviteUrl: string | null;
  }> => {
    params.setAppMode('home');
    params.preventAutoRejoinRef.current = false;
    params.autoJoinAttemptedRef.current = false;
    const activeSocket = params.socketRef.current;
    if (params.joinedRoomRef.current) {
      params.setAppMode('multiplayer');
      params.setRoomCode(params.joinedRoomRef.current);
      params.resolvePendingCreate(params.joinedRoomRef.current);
      const code = params.normalizeRoomCode(params.joinedRoomRef.current);
      return {
        ok: Boolean(code),
        roomCode: code || null,
        inviteUrl: code ? params.getInviteLink(code) : null,
      };
    }
    if (activeSocket?.connected) {
      try {
        const resp = await params.emitCreateRoom(activeSocket);
        const code = params.normalizeRoomCode(resp?.roomCode);
        if (code) {
          params.setRoomCode(code);
          params.setPlayers(params.normalizeRoomPlayers(resp.players ?? []));
          params.setAppMode('multiplayer');
        }
        return {
          ok: Boolean(code),
          roomCode: code || null,
          inviteUrl: code ? params.getInviteLink(code) : null,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Action failed';
        params.setError(message);
        params.showToast(message, 2000);
        return { ok: false, roomCode: null, inviteUrl: null };
      }
    }
    params.pendingCreateOnConnectRef.current = true;
    params.connectRef.current();
    const roomCode = await new Promise<string | null>((resolve) => {
      let done = false;
      const timer = window.setTimeout(() => {
        if (done) return;
        done = true;
        resolve(null);
      }, 8000);
      params.pendingCreateResolversRef.current.push((code) => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        resolve(code);
      });
    });
    const code = params.normalizeRoomCode(roomCode);
    if (!code) return { ok: false, roomCode: null, inviteUrl: null };
    return { ok: true, roomCode: code, inviteUrl: params.getInviteLink(code) };
  }, [params]);

  const copyInviteLink = useCallback(async (): Promise<{
    ok: boolean;
    roomCode: string | null;
    inviteUrl: string | null;
  }> => {
    let code = params.normalizeRoomCode(params.joinedRoomRef.current ?? params.roomCode);
    if (!code) {
      const created = await onCreatePrivateRoom();
      code = params.normalizeRoomCode(created.roomCode ?? params.roomCode);
    }
    if (!code) {
      params.showToast('Could not prepare an invite link.');
      return { ok: false, roomCode: null, inviteUrl: null };
    }
    const link = params.getInviteLink(code);
    if (!link) return { ok: false, roomCode: null, inviteUrl: null };
    try {
      await navigator.clipboard.writeText(link);
      params.showToast('Invite link copied.');
      return { ok: true, roomCode: code, inviteUrl: link };
    } catch {
      params.showToast('Could not copy invite link.');
      return { ok: false, roomCode: code, inviteUrl: link };
    }
  }, [onCreatePrivateRoom, params]);

  const createRoom = useCallback(async (settings?: PrivateRoomCreateSettings) => {
    params.setError('');
    params.setActionError('');
    if (!params.socket) {
      params.setError('Not connected to server.');
      return;
    }
    if (params.createInFlightRef.current) return;
    params.createInFlightRef.current = true;
    params.setPendingUiAction('create');
    try {
      await params.emitCreateRoom(params.socket, settings);
    } catch (error) {
      params.showToast(error instanceof Error ? error.message : 'Action failed', 2000);
    } finally {
      params.createInFlightRef.current = false;
      params.setPendingUiAction((prev) => (prev === 'create' ? null : prev));
    }
  }, [params]);

  const joinRoom = useCallback(async () => {
    params.setError('');
    params.setActionError('');
    if (!params.socket) {
      params.setError('Not connected to server.');
      return;
    }
    if (params.joinInFlightRef.current) return;
    params.joinInFlightRef.current = true;
    params.setPendingUiAction('join');
    try {
      const resp = await params.emitWithAck<any>(
        params.socket,
        'room:join',
        params.roomCode.trim().toUpperCase(),
        roomJoinConfig(),
      );
      if (!resp?.ok) {
        params.setError(resp?.error ?? 'Unable to join room.');
        return;
      }
      params.setError('');
      params.setActionError('');
      params.applyJoinedRoomResponse(resp);
      params.autoJoinAttemptedRef.current = false;
      params.preventAutoRejoinRef.current = false;
    } catch (error) {
      params.showToast(error instanceof Error ? error.message : 'Action failed', 2000);
    } finally {
      params.joinInFlightRef.current = false;
      params.setPendingUiAction((prev) => (prev === 'join' ? null : prev));
    }
  }, [params, roomJoinConfig]);

  const ensureSocketConnected = useCallback(async (): Promise<boolean> => {
    const activeSocket = params.socketRef.current;
    if (activeSocket?.connected) return true;
    params.connectRef.current();
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('Connection timed out')), 15000);
        params.socketRef.current?.once('connect', () => {
          window.clearTimeout(timeout);
          resolve();
        });
        params.socketRef.current?.once('connect_error', () => {
          window.clearTimeout(timeout);
          reject(new Error('Connection failed'));
        });
      });
      return Boolean(params.socketRef.current?.connected);
    } catch {
      return false;
    }
  }, [params]);

  const sendFriendChallenge = useCallback(
    async (target: FriendChallengeTarget): Promise<SendFriendChallengeResult> => {
      if (!target.userId || target.userId.startsWith('demo-')) {
        return { ok: false, error: 'invalid_target' };
      }
      if (!params.authUserId) {
        return { ok: false, error: 'invalid_target' };
      }
      if (target.userId === params.authUserId) {
        return { ok: false, error: 'self' };
      }
      if (target.presenceStatus === 'offline') {
        return { ok: false, error: 'offline' };
      }
      if (target.presenceStatus === 'in_game') {
        return { ok: false, error: 'in_game' };
      }
      if (
        params.outboundChallenge
        && params.outboundChallenge.friendUserId === target.userId
      ) {
        return { ok: false, error: 'already_pending' };
      }
      if (params.outboundChallenge) {
        return { ok: false, error: 'already_pending' };
      }

      const connected = await ensureSocketConnected();
      if (!connected || !params.socketRef.current) {
        return { ok: false, error: 'not_connected' };
      }

      let roomCode = params.normalizeRoomCode(params.joinedRoomRef.current);
      if (!roomCode) {
        try {
          const resp = await params.emitCreateRoom(params.socketRef.current);
          roomCode = params.normalizeRoomCode(resp?.roomCode);
          if (roomCode) {
            params.setRoomCode(roomCode);
            params.setPlayers(params.normalizeRoomPlayers(resp?.players ?? []));
          }
        } catch {
          return { ok: false, error: 'room_failed' };
        }
      }

      const inviteUrl = roomCode ? params.getInviteLink(roomCode) : '';
      if (!roomCode || !inviteUrl) {
        return { ok: false, error: 'room_failed' };
      }

      const inviteId = makeFriendChallengeInviteId();
      try {
        const deliverResp = await params.emitWithAck<{
          ok?: boolean;
          error?: string;
          delivered?: boolean;
        }>(params.socketRef.current, 'friend:invite', {
          inviteId,
          toUserId: target.userId,
          fromUsername: params.authUsername,
          fromUserId: params.authUserId,
          roomCode,
          inviteUrl,
          matchSummary: FRIEND_CHALLENGE_MATCH_SUMMARY,
        });
        if (!deliverResp?.ok) {
          if (deliverResp?.error === 'recipient_unreachable') {
            return { ok: false, error: 'unreachable' };
          }
          if (deliverResp?.error === 'room_not_found') {
            return { ok: false, error: 'room_failed' };
          }
          return { ok: false, error: 'unreachable' };
        }
      } catch {
        return { ok: false, error: 'unreachable' };
      }

      const expiresAt = Date.now() + FRIEND_CHALLENGE_EXPIRY_MS;
      params.setOutboundChallenge({
        inviteId,
        friendUserId: target.userId,
        friendUsername: target.username,
        roomCode,
        matchSummary: FRIEND_CHALLENGE_MATCH_SUMMARY,
        expiresAt,
      });

      params.setAppMode('multiplayer');
      params.setMpSubView('private');
      params.setRoomCode(roomCode);

      return {
        ok: true,
        inviteId,
        roomCode,
        expiresAt,
      };
    },
    [ensureSocketConnected, params],
  );

  const declineFriendInvite = useCallback(() => {
    const invite = params.friendInvite;
    if (!invite || !params.socket?.connected) {
      params.setFriendInvite(null);
      return;
    }
    if (invite.fromUserId) {
      params.socket.emit('friend:invite:decline', {
        toUserId: invite.fromUserId,
        roomCode: invite.roomCode,
        inviteId: invite.inviteId,
      });
    }
    params.setFriendInvite(null);
    params.showToast('Challenge declined.', 1800);
  }, [params]);

  const acceptFriendInvite = useCallback(async () => {
    if (!params.socket || !params.friendInvite) return;
    if (params.inviteJoinInFlightRef.current) return;
    params.inviteJoinInFlightRef.current = true;

    if (!params.socket.connected) {
      try {
        params.socket.connect();
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error('Connection timed out')), 15000);
          params.socket?.once('connect', () => {
            window.clearTimeout(timeout);
            resolve();
          });
          params.socket?.once('connect_error', () => {
            window.clearTimeout(timeout);
            reject(new Error('Connection failed'));
          });
        });
      } catch {
        params.showToast('Could not connect to server. Try again.', 2000);
        params.inviteJoinInFlightRef.current = false;
        params.setPendingUiAction(null);
        return;
      }
    }

    params.preventAutoRejoinRef.current = true;
    params.setPendingUiAction('join');
    params.setError('');
    params.setActionError('');

    try {
      const resp = await params.emitWithAck<any>(
        params.socket,
        'room:join',
        params.normalizeRoomCode(params.friendInvite.roomCode),
        roomJoinConfig(),
      );
      if (!resp?.ok) {
        throw new Error(resp?.error ?? 'Unable to join room from invite.');
      }
      params.applyJoinedRoomResponse(resp);
      params.setAppMode('multiplayer');
      params.setMpSubView('private');
      params.autoJoinAttemptedRef.current = false;
      params.setFriendInvite(null);
    } catch (error) {
      params.showToast(error instanceof Error ? error.message : 'Action failed', 2000);
    } finally {
      params.inviteJoinInFlightRef.current = false;
      params.preventAutoRejoinRef.current = false;
      params.setPendingUiAction((prev) => (prev === 'join' ? null : prev));
    }
  }, [params, roomJoinConfig]);

  useEffect(() => {
    if (!params.socket || !params.socket.connected || params.joinedRoomRef.current || params.autoJoinAttemptedRef.current) {
      return;
    }
    if (params.inviteJoinInFlightRef.current) return;
    const linkedCode =
      typeof window !== 'undefined'
        ? params.normalizeRoomCode(new URLSearchParams(window.location.search).get('room'))
        : '';
    if (!linkedCode) return;

    params.autoJoinAttemptedRef.current = true;
    params.setRoomCode(linkedCode);
    void (async () => {
      try {
        const resp = await params.emitWithAck<any>(
          params.socket!,
          'room:join',
          linkedCode,
          roomJoinConfig(),
        );
        if (!resp?.ok) {
          params.setError(resp?.error ?? 'Unable to join room from invite link.');
          return;
        }
        params.applyJoinedRoomResponse(resp);
      } catch (error) {
        params.showToast(error instanceof Error ? error.message : 'Action failed', 2000);
      }
    })();
  }, [
    params.socket,
    params.joinedRoomRef,
    params.autoJoinAttemptedRef,
    params.inviteJoinInFlightRef,
    params.normalizeRoomCode,
    params.setRoomCode,
    params.emitWithAck,
    params.setError,
    params.applyJoinedRoomResponse,
    params.showToast,
    roomJoinConfig,
  ]);

  return {
    onCreatePrivateRoom,
    copyInviteLink,
    createRoom,
    joinRoom,
    acceptFriendInvite,
    declineFriendInvite,
    sendFriendChallenge,
  };
}
