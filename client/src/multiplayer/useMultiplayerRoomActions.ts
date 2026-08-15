import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import {
  FRIEND_CHALLENGE_EXPIRY_MS,
  FRIEND_CHALLENGE_MATCH_SUMMARY,
  makeFriendChallengeInviteId,
  type FriendChallengeTarget,
  type SendFriendChallengeResult,
} from './friendChallenge';
import type { PrivateRoomCreateSettings, RoomAckResponse } from './roomTransport';
import {
  createMultiplayerRoomActionsScope,
  type MultiplayerRoomActionsScope,
  type MultiplayerRoomActionsScopeSource,
} from './multiplayerRoomActionsScope';
import { recordJoinLatency } from './mpTelemetry';
import { selectJoinedRoomCode } from './session/sessionStateMachine';
import {
  beginRoomOperation,
  isCurrentRoomOperation,
} from './roomOperationEpoch';
import { logger } from '../utils/logger';

type RoomJoinConfig = {
  username: string;
  userId: string | null;
  authToken: string | null;
};

export type UseMultiplayerRoomActionsParams = MultiplayerRoomActionsScopeSource;

export function useMultiplayerRoomActions(inputParams: UseMultiplayerRoomActionsParams) {
  const scopeRef = useRef<MultiplayerRoomActionsScope>(null!);
  useLayoutEffect(() => {
    scopeRef.current = createMultiplayerRoomActionsScope(inputParams);
  });

  const roomJoinConfig = useCallback((): RoomJoinConfig => {
    const scope = scopeRef.current;
    return (
      scope.room.roomIdentityRef.current ?? {
        username: scope.auth.authUsername,
        userId: scope.auth.authUserId,
        authToken: scope.auth.authToken,
      }
    );
  }, [
    inputParams.auth.authUsername,
    inputParams.auth.authUserId,
    inputParams.auth.authToken,
    inputParams.roomRuntime.roomIdentityRef,
  ]);

  const onCreatePrivateRoom = useCallback(async (): Promise<{
    ok: boolean;
    roomCode: string | null;
    inviteUrl: string | null;
  }> => {
    const scope = scopeRef.current;
    scope.navigation.setAppMode('home');
    scope.reconnect.preventAutoRejoinRef.current = false;
    scope.joinFlight.autoJoinAttemptedRef.current = false;
    const activeSocket = scope.transport.socketRef.current;
    const joinedRoomCode = selectJoinedRoomCode(scope.session.sessionRef.current);
    if (joinedRoomCode) {
      scope.navigation.setAppMode('multiplayer');
      scope.ui.setRoomCode(joinedRoomCode);
      scope.transport.resolvePendingCreate(joinedRoomCode);
      const code = scope.transport.normalizeRoomCode(joinedRoomCode);
      return {
        ok: Boolean(code),
        roomCode: code || null,
        inviteUrl: code ? scope.transport.getInviteLink(code) : null,
      };
    }
    if (activeSocket?.connected) {
      try {
        const resp = await scope.transport.emitCreateRoom(activeSocket);
        const code = scope.transport.normalizeRoomCode(resp?.roomCode);
        if (code) {
          scope.ui.setRoomCode(code);
          scope.ui.setPlayers(scope.transport.normalizeRoomPlayers(resp.players ?? []));
          scope.navigation.setAppMode('multiplayer');
        }
        return {
          ok: Boolean(code),
          roomCode: code || null,
          inviteUrl: code ? scope.transport.getInviteLink(code) : null,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Action failed';
        scope.ui.setError(message);
        scope.ui.showToast(message, 2000);
        return { ok: false, roomCode: null, inviteUrl: null };
      }
    }
    scope.joinFlight.pendingCreateOnConnectRef.current = true;
    scope.transport.connectRef.current();
    const roomCode = await new Promise<string | null>((resolve) => {
      let done = false;
      const timer = window.setTimeout(() => {
        if (done) return;
        done = true;
        resolve(null);
      }, 8000);
      scope.joinFlight.pendingCreateResolversRef.current.push((code) => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        resolve(code);
      });
    });
    const code = scope.transport.normalizeRoomCode(roomCode);
    if (!code) return { ok: false, roomCode: null, inviteUrl: null };
    return { ok: true, roomCode: code, inviteUrl: scope.transport.getInviteLink(code) };
  }, []);

  const copyInviteLink = useCallback(async (): Promise<{
    ok: boolean;
    roomCode: string | null;
    inviteUrl: string | null;
  }> => {
    const scope = scopeRef.current;
    let code = scope.transport.normalizeRoomCode(
      selectJoinedRoomCode(scope.session.sessionRef.current) ?? scope.room.roomCode,
    );
    if (!code) {
      const created = await onCreatePrivateRoom();
      code = scope.transport.normalizeRoomCode(created.roomCode ?? scope.room.roomCode);
    }
    if (!code) {
      scope.ui.showToast('Could not prepare an invite link.');
      return { ok: false, roomCode: null, inviteUrl: null };
    }
    const link = scope.transport.getInviteLink(code);
    if (!link) return { ok: false, roomCode: null, inviteUrl: null };
    try {
      await navigator.clipboard.writeText(link);
      scope.ui.showToast('Invite link copied.');
      return { ok: true, roomCode: code, inviteUrl: link };
    } catch {
      scope.ui.showToast('Could not copy invite link.');
      return { ok: false, roomCode: code, inviteUrl: link };
    }
  }, [onCreatePrivateRoom]);

  const createRoom = useCallback(async (settings?: PrivateRoomCreateSettings) => {
    const scope = scopeRef.current;
    scope.ui.setError('');
    scope.ui.setActionError('');
    if (!scope.transport.socket) {
      scope.ui.setError('Not connected to server.');
      return;
    }
    if (scope.joinFlight.createInFlightRef.current) return;
    scope.joinFlight.createInFlightRef.current = true;
    scope.ui.setPendingUiAction('create');
    try {
      await scope.transport.emitCreateRoom(scope.transport.socket, settings);
    } catch (error) {
      scope.ui.showToast(error instanceof Error ? error.message : 'Action failed', 2000);
    } finally {
      scope.joinFlight.createInFlightRef.current = false;
      scope.ui.setPendingUiAction((prev) => (prev === 'create' ? null : prev));
    }
  }, []);

  const joinRoom = useCallback(async () => {
    const scope = scopeRef.current;
    scope.ui.setError('');
    scope.ui.setActionError('');
    if (!scope.transport.socket) {
      scope.ui.setError('Not connected to server.');
      return;
    }
    if (scope.joinFlight.joinInFlightRef.current) return;
    scope.joinFlight.joinInFlightRef.current = true;
    scope.ui.setPendingUiAction('join');
    const operationToken = beginRoomOperation(scope.roomOperationEpochRef);
    try {
      const joinStartedAt =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      const resp = await scope.transport.emitWithAck<RoomAckResponse>(
        scope.transport.socket,
        'room:join',
        scope.room.roomCode.trim().toUpperCase(),
        roomJoinConfig(),
      );
      if (resp?.ok) {
        const joinEndedAt =
          typeof performance !== 'undefined' ? performance.now() : Date.now();
        recordJoinLatency(joinEndedAt - joinStartedAt, 'join');
      }
      if (!isCurrentRoomOperation(scope.roomOperationEpochRef, operationToken)) {
        return;
      }
      if (!resp?.ok) {
        scope.ui.setError(resp?.error ?? 'Unable to join room.');
        return;
      }
      scope.ui.setError('');
      scope.ui.setActionError('');
      scope.room.applyJoinedRoomResponse(resp);
      scope.joinFlight.autoJoinAttemptedRef.current = false;
      scope.reconnect.preventAutoRejoinRef.current = false;
    } catch (error) {
      if (!isCurrentRoomOperation(scope.roomOperationEpochRef, operationToken)) {
        return;
      }
      scope.ui.showToast(error instanceof Error ? error.message : 'Action failed', 2000);
    } finally {
      scope.joinFlight.joinInFlightRef.current = false;
      scope.ui.setPendingUiAction((prev) => (prev === 'join' ? null : prev));
    }
  }, [roomJoinConfig]);

  const ensureSocketConnected = useCallback(async (): Promise<boolean> => {
    const scope = scopeRef.current;
    const activeSocket = scope.transport.socketRef.current;
    if (activeSocket?.connected) return true;
    scope.transport.connectRef.current();
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('Connection timed out')), 15000);
        scope.transport.socketRef.current?.once('connect', () => {
          window.clearTimeout(timeout);
          resolve();
        });
        scope.transport.socketRef.current?.once('connect_error', () => {
          window.clearTimeout(timeout);
          reject(new Error('Connection failed'));
        });
      });
      return Boolean(scope.transport.socketRef.current?.connected);
    } catch {
      return false;
    }
  }, []);

  const sendFriendChallenge = useCallback(
    async (target: FriendChallengeTarget): Promise<SendFriendChallengeResult> => {
      const scope = scopeRef.current;
      if (!target.userId || target.userId.startsWith('demo-')) {
        return { ok: false, error: 'invalid_target' };
      }
      if (!scope.auth.authUserId) {
        return { ok: false, error: 'invalid_target' };
      }
      if (target.userId === scope.auth.authUserId) {
        return { ok: false, error: 'self' };
      }
      if (target.presenceStatus === 'in_game') {
        return { ok: false, error: 'in_game' };
      }
      if (
        scope.ui.outboundChallenge
        && scope.ui.outboundChallenge.friendUserId === target.userId
      ) {
        return { ok: false, error: 'already_pending' };
      }
      if (scope.ui.outboundChallenge) {
        return { ok: false, error: 'already_pending' };
      }

      const connected = await ensureSocketConnected();
      if (!connected || !scope.transport.socketRef.current) {
        return { ok: false, error: 'not_connected' };
      }

      let roomCode = scope.transport.normalizeRoomCode(
        selectJoinedRoomCode(scope.session.sessionRef.current),
      );
      if (!roomCode) {
        try {
          const resp = await scope.transport.emitCreateRoom(scope.transport.socketRef.current);
          roomCode = scope.transport.normalizeRoomCode(resp?.roomCode);
          if (roomCode) {
            scope.ui.setRoomCode(roomCode);
            scope.ui.setPlayers(scope.transport.normalizeRoomPlayers(resp?.players ?? []));
          }
        } catch {
          return { ok: false, error: 'room_failed' };
        }
      }

      const inviteUrl = roomCode ? scope.transport.getInviteLink(roomCode) : '';
      if (!roomCode || !inviteUrl) {
        return { ok: false, error: 'room_failed' };
      }

      const inviteId = makeFriendChallengeInviteId();
      let durableInviteId = inviteId;
      let durableExpiresAt: string | undefined;
      try {
        const deliverResp = await scope.transport.emitWithAck<{
          ok?: boolean;
          error?: string;
          delivered?: boolean;
          inviteId?: string;
          expiresAt?: string;
        }>(scope.transport.socketRef.current, 'friend:invite', {
          inviteId,
          toUserId: target.userId,
          fromUsername: scope.auth.authUsername,
          fromUserId: scope.auth.authUserId,
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
        durableInviteId = deliverResp.inviteId ?? inviteId;
        durableExpiresAt = deliverResp.expiresAt;
      } catch {
        return { ok: false, error: 'unreachable' };
      }

      const serverExpiresAt = Date.parse(durableExpiresAt ?? '');
      const expiresAt = Number.isFinite(serverExpiresAt)
        ? serverExpiresAt
        : Date.now() + FRIEND_CHALLENGE_EXPIRY_MS;
      scope.ui.setOutboundChallenge({
        inviteId: durableInviteId,
        friendUserId: target.userId,
        friendUsername: target.username,
        roomCode,
        matchSummary: FRIEND_CHALLENGE_MATCH_SUMMARY,
        expiresAt,
      });

      scope.navigation.setAppMode('multiplayer');
      scope.ui.setMpSubView('private');
      scope.ui.setRoomCode(roomCode);

      return {
        ok: true,
        inviteId: durableInviteId,
        roomCode,
        expiresAt,
      };
    },
    [ensureSocketConnected],
  );

  const declineFriendInvite = useCallback(() => {
    const scope = scopeRef.current;
    const invite = scope.ui.friendInvite;
    if (!invite || !scope.transport.socket?.connected) {
      scope.ui.setFriendInvite(null);
      return;
    }
    if (invite.fromUserId) {
      scope.transport.socket.emit('friend:invite:decline', {
        toUserId: invite.fromUserId,
        roomCode: invite.roomCode,
        inviteId: invite.inviteId,
      });
    }
    scope.ui.setFriendInvite(null);
    scope.ui.showToast('Challenge declined.', 1800);
  }, []);

  const acceptFriendInvite = useCallback(async () => {
    const scope = scopeRef.current;
    if (!scope.transport.socket || !scope.ui.friendInvite) return;
    if (scope.joinFlight.inviteJoinInFlightRef.current) return;
    scope.joinFlight.inviteJoinInFlightRef.current = true;

    if (!scope.transport.socket.connected) {
      try {
        scope.transport.socket.connect();
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error('Connection timed out')), 15000);
          scope.transport.socket?.once('connect', () => {
            window.clearTimeout(timeout);
            resolve();
          });
          scope.transport.socket?.once('connect_error', () => {
            window.clearTimeout(timeout);
            reject(new Error('Connection failed'));
          });
        });
      } catch {
        scope.ui.showToast('Could not connect to server. Try again.', 2000);
        scope.joinFlight.inviteJoinInFlightRef.current = false;
        scope.ui.setPendingUiAction(null);
        return;
      }
    }

    scope.reconnect.preventAutoRejoinRef.current = true;
    scope.ui.setPendingUiAction('join');
    scope.ui.setError('');
    scope.ui.setActionError('');
    const operationToken = beginRoomOperation(scope.roomOperationEpochRef);

    try {
      const resp = await scope.transport.emitWithAck<RoomAckResponse>(
        scope.transport.socket,
        'room:join',
        scope.transport.normalizeRoomCode(scope.ui.friendInvite.roomCode),
        roomJoinConfig(),
      );
      if (!resp?.ok) {
        throw new Error(resp?.error ?? 'Unable to join room from invite.');
      }
      if (!isCurrentRoomOperation(scope.roomOperationEpochRef, operationToken)) return;
      scope.room.applyJoinedRoomResponse(resp);
      const acceptedInviteId = scope.ui.friendInvite.inviteId;
      void scope.transport.emitWithAck(
        scope.transport.socket,
        'friend:invite:accept',
        { inviteId: acceptedInviteId },
      ).catch((error) => {
        logger.error('multiplayer.invite_accept_persist', error, { inviteId: acceptedInviteId });
      });
      scope.navigation.setAppMode('multiplayer');
      scope.ui.setMpSubView('private');
      scope.joinFlight.autoJoinAttemptedRef.current = false;
      scope.ui.setFriendInvite(null);
    } catch (error) {
      if (!isCurrentRoomOperation(scope.roomOperationEpochRef, operationToken)) return;
      scope.ui.showToast(error instanceof Error ? error.message : 'Action failed', 2000);
    } finally {
      scope.joinFlight.inviteJoinInFlightRef.current = false;
      scope.reconnect.preventAutoRejoinRef.current = false;
      scope.ui.setPendingUiAction((prev) => (prev === 'join' ? null : prev));
    }
  }, [roomJoinConfig]);

  useEffect(() => {
    const scope = scopeRef.current;
    if (
      !scope.transport.socket ||
      !scope.transport.socket.connected ||
      selectJoinedRoomCode(scope.session.sessionRef.current) ||
      scope.joinFlight.autoJoinAttemptedRef.current
    ) {
      return;
    }
    if (scope.joinFlight.inviteJoinInFlightRef.current) return;
    const linkedCode =
      typeof window !== 'undefined'
        ? scope.transport.normalizeRoomCode(new URLSearchParams(window.location.search).get('room'))
        : '';
    if (!linkedCode) return;

    scope.joinFlight.autoJoinAttemptedRef.current = true;
    scope.ui.setRoomCode(linkedCode);
    const operationToken = beginRoomOperation(scope.roomOperationEpochRef);
    void (async () => {
      try {
        const resp = await scope.transport.emitWithAck<RoomAckResponse>(
          scope.transport.socket!,
          'room:join',
          linkedCode,
          roomJoinConfig(),
        );
        if (!isCurrentRoomOperation(scope.roomOperationEpochRef, operationToken)) {
          return;
        }
        if (!resp?.ok) {
          scope.ui.setError(resp?.error ?? 'Unable to join room from invite link.');
          return;
        }
        scope.room.applyJoinedRoomResponse(resp);
        scope.navigation.setAppMode('multiplayer');
        scope.ui.setMpSubView('private');
      } catch (error) {
        if (!isCurrentRoomOperation(scope.roomOperationEpochRef, operationToken)) {
          return;
        }
        scope.ui.showToast(error instanceof Error ? error.message : 'Action failed', 2000);
      }
    })();
  }, [
    inputParams.socket,
    inputParams.sessionRuntime.sessionRef,
    inputParams.joinFlightRuntime.autoJoinAttemptedRef,
    inputParams.joinFlightRuntime.inviteJoinInFlightRef,
    inputParams.transport.normalizeRoomCode,
    inputParams.ui.setRoomCode,
    inputParams.transport.emitWithAck,
    inputParams.ui.setError,
    inputParams.applyJoinedRoomResponse,
    inputParams.ui.showToast,
    roomJoinConfig,
  ]);

  const spectateRoom = useCallback(
    async (roomCode: string) => {
      const scope = scopeRef.current;
      const socket = scope.transport.socketRef.current;
      if (!socket) return { ok: false, error: 'no_socket' };

      const connected = await ensureSocketConnected();
      if (!connected) {
        scope.ui.showToast('Could not connect to server. Try again.', 2000);
        return { ok: false, error: 'not_connected' };
      }

      scope.reconnect.preventAutoRejoinRef.current = true;
      scope.ui.setPendingUiAction('join');
      scope.ui.setError('');
      scope.ui.setActionError('');
      const operationToken = beginRoomOperation(scope.roomOperationEpochRef);

      try {
        const resp = await scope.transport.emitWithAck<RoomAckResponse>(
          socket,
          'room:spectate',
          scope.transport.normalizeRoomCode(roomCode),
          roomJoinConfig(),
        );
        if (!resp?.ok) {
          throw new Error(resp?.error ?? 'Unable to spectate room.');
        }
        if (!isCurrentRoomOperation(scope.roomOperationEpochRef, operationToken)) {
          return { ok: false, error: 'stale_response' };
        }
        scope.room.applyJoinedRoomResponse(resp);
        scope.navigation.setAppMode('multiplayer');
        return { ok: true };
      } catch (error) {
        if (!isCurrentRoomOperation(scope.roomOperationEpochRef, operationToken)) {
          return { ok: false, error: 'stale_response' };
        }
        const msg = error instanceof Error ? error.message : 'Spectate failed';
        scope.ui.showToast(msg, 2000);
        scope.ui.setPendingUiAction(null);
        return { ok: false, error: msg };
      }
    },
    [ensureSocketConnected, roomJoinConfig],
  );

  return {
    onCreatePrivateRoom,
    copyInviteLink,
    createRoom,
    joinRoom,
    acceptFriendInvite,
    declineFriendInvite,
    sendFriendChallenge,
    spectateRoom,
  };
}
