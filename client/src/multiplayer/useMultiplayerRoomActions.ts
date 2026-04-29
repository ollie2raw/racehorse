import { useCallback, useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';

type PendingUiAction = null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play';

type RoomJoinConfig = {
  username: string;
  userId: string | null;
  authToken: string | null;
};

type FriendInvite = {
  fromUsername: string;
  roomCode: string;
  inviteUrl: string;
} | null;

type UseMultiplayerRoomActionsParams = {
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
  friendInvite: FriendInvite;
  authUsername: string;
  authUserId: string | null;
  authToken: string | null;
  authUsernameRef: MutableRefObject<string>;
  authUserIdRef: MutableRefObject<string | null>;
  authTokenRef: MutableRefObject<string | null>;
  normalizeRoomCode: (value: unknown) => string;
  normalizeRoomPlayers: (value: unknown) => any[];
  emitWithAck: <TResp>(
    socket: { emit: (...args: any[]) => void },
    event: string,
    ...argsWithoutAck: any[]
  ) => Promise<TResp>;
  emitCreateRoom: (targetSocket: Socket) => Promise<any>;
  getInviteLink: (code: string) => string;
  resolvePendingCreate: (code: string | null) => void;
  applyJoinedRoomResponse: (resp: any) => void;
  showToast: (message: string, duration?: number) => void;
  setAppMode: Dispatch<
    SetStateAction<
      | 'home'
      | 'multiplayer'
      | 'noBrainer'
      | 'botSetup'
      | 'bot'
      | 'ghostSetup'
      | 'ghost'
      | 'daily'
      | 'dailyFritz'
      | 'league'
      | 'learn'
      | 'ratingHistory'
      | 'singlePlayerHub'
      | 'tournament'
    >
  >;
  setRoomCode: Dispatch<SetStateAction<string>>;
  setPlayers: Dispatch<SetStateAction<any[]>>;
  setError: Dispatch<SetStateAction<string>>;
  setActionError: Dispatch<SetStateAction<string>>;
  setPendingUiAction: Dispatch<SetStateAction<PendingUiAction>>;
  setRoomRecoveryState: Dispatch<SetStateAction<'idle' | 'reconnecting' | 'resyncing' | 'failed'>>;
  setRoomRecoveryMessage: Dispatch<SetStateAction<string>>;
  setFriendsOpen: Dispatch<SetStateAction<boolean>>;
  setFriendInvite: Dispatch<SetStateAction<FriendInvite>>;
  lastRoomStorageKey: string;
};

export function useMultiplayerRoomActions(params: UseMultiplayerRoomActionsParams) {
  const roomJoinConfig = useCallback(
    (): RoomJoinConfig => ({
      username: params.authUsername,
      userId: params.authUserId,
      authToken: params.authToken,
    }),
    [params.authUsername, params.authUserId, params.authToken],
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

  const createRoom = useCallback(async () => {
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
      await params.emitCreateRoom(params.socket);
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

  const openLeagueLiveRoom = useCallback(
    async (code: string) => {
      const normalizedCode = params.normalizeRoomCode(code);
      if (!normalizedCode) {
        throw new Error('Live room code is invalid.');
      }

      params.setRoomCode(normalizedCode);
      params.setAppMode('multiplayer');
      params.setError('');
      params.setActionError('');

      const activeSocket = params.socketRef.current;
      if (activeSocket?.connected) {
        const resp = await params.emitWithAck<any>(
          activeSocket,
          'room:join',
          normalizedCode,
          {
            username: params.authUsernameRef.current,
            userId: params.authUserIdRef.current,
            authToken: params.authTokenRef.current,
          },
        );
        if (!resp?.ok) {
          throw new Error(resp?.error ?? 'Unable to join live room.');
        }
        params.applyJoinedRoomResponse(resp);
        params.autoJoinAttemptedRef.current = false;
        params.preventAutoRejoinRef.current = false;
        return;
      }

      params.reconnectRoomCodeRef.current = normalizedCode;
      params.reconnectShouldJoinRef.current = true;
      params.preventAutoRejoinRef.current = false;
      params.autoJoinAttemptedRef.current = false;
      params.setRoomRecoveryState('reconnecting');
      params.setRoomRecoveryMessage('Joining live room…');
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(params.lastRoomStorageKey, normalizedCode);
      }
      params.connectRef.current();
    },
    [params],
  );

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
      params.setFriendsOpen(false);
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
    openLeagueLiveRoom,
    acceptFriendInvite,
  };
}
