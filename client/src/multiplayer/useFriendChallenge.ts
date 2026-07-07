import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { registerRawSocketEventHandler, type RawSocketHandler } from './socketEventBus';
import { SOCKET_EVENTS } from './socketEventRegistry';
import {
  challengeButtonLabel,
  isChallengeButtonDisabled,
  type FriendChallengeState,
  type FriendChallengeTarget,
  type FriendInviteDeclinedPayload,
  type OutboundChallenge,
  type SendFriendChallengeResult,
} from './friendChallenge';

type UseFriendChallengeParams = {
  socket: Socket | null;
  connect?: () => void;
  sendFriendChallenge: (target: FriendChallengeTarget) => Promise<SendFriendChallengeResult>;
  showToast: (message: string, duration?: number) => void;
  outboundChallenge: OutboundChallenge | null;
  clearOutboundChallenge: () => void;
  isSocketReachable: (userId: string) => boolean;
  hasReachabilitySnapshot: boolean;
};

type ChallengeEntry = {
  state: FriendChallengeState;
  inviteId?: string;
  expiresAt?: number;
};

export function useFriendChallenge({
  socket,
  connect,
  sendFriendChallenge,
  showToast,
  outboundChallenge,
  clearOutboundChallenge,
  isSocketReachable,
  hasReachabilitySnapshot,
}: UseFriendChallengeParams) {
  const [byUserId, setByUserId] = useState<Record<string, ChallengeEntry>>({});
  const expiryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const clearExpiryTimer = useCallback((userId: string) => {
    const timer = expiryTimersRef.current.get(userId);
    if (timer) {
      clearTimeout(timer);
      expiryTimersRef.current.delete(userId);
    }
  }, []);

  const setEntry = useCallback((userId: string, entry: ChallengeEntry) => {
    setByUserId((prev) => ({ ...prev, [userId]: entry }));
  }, []);

  const resetEntry = useCallback(
    (userId: string, state: FriendChallengeState = 'idle') => {
      clearExpiryTimer(userId);
      setEntry(userId, { state });
    },
    [clearExpiryTimer, setEntry],
  );

  const resolveState = useCallback(
    (userId: string): FriendChallengeState => {
      if (
        outboundChallenge
        && outboundChallenge.friendUserId === userId
        && outboundChallenge.expiresAt > Date.now()
      ) {
        return 'pending';
      }
      return byUserId[userId]?.state ?? 'idle';
    },
    [byUserId, outboundChallenge],
  );

  const isUnreachable = useCallback(
    (userId: string, presenceStatus: FriendChallengeTarget['presenceStatus']) => {
      if (presenceStatus === 'offline' || presenceStatus === 'in_game') return false;
      if (!hasReachabilitySnapshot) return true;
      return !isSocketReachable(userId);
    },
    [hasReachabilitySnapshot, isSocketReachable],
  );

  const scheduleLocalExpiry = useCallback(
    (userId: string, inviteId: string, expiresAt: number) => {
      clearExpiryTimer(userId);
      const delay = Math.max(0, expiresAt - Date.now());
      const timer = setTimeout(() => {
        expiryTimersRef.current.delete(userId);
        if (outboundChallenge?.inviteId === inviteId) {
          clearOutboundChallenge();
        }
        setByUserId((prev) => {
          const current = prev[userId];
          if (!current || current.inviteId !== inviteId) return prev;
          return { ...prev, [userId]: { state: 'expired' } };
        });
        window.setTimeout(() => resetEntry(userId, 'idle'), 400);
      }, delay);
      expiryTimersRef.current.set(userId, timer);
    },
    [clearExpiryTimer, clearOutboundChallenge, outboundChallenge?.inviteId, resetEntry],
  );

  const challengeFriend = useCallback(
    async (target: FriendChallengeTarget) => {
      if (target.userId.startsWith('demo-')) {
        showToast('Sign in with friends to send challenges.', 2200);
        return;
      }
      if (target.presenceStatus === 'offline') {
        showToast(`${target.username} is offline.`, 2000);
        return;
      }
      if (target.presenceStatus === 'in_game') {
        showToast(`${target.username} is in a match.`, 2000);
        return;
      }
      if (isUnreachable(target.userId, target.presenceStatus)) {
        showToast('Couldn’t send challenge — friend is not reachable right now.', 2600);
        return;
      }
      if (outboundChallenge) {
        showToast('Finish your current challenge first.', 2000);
        return;
      }

      const current = resolveState(target.userId);
      if (current === 'pending' || current === 'creating' || current === 'accepted') return;

      if (!socket?.connected) connect?.();

      setEntry(target.userId, { state: 'creating' });

      const result = await sendFriendChallenge(target);
      if (!result.ok) {
        resetEntry(target.userId, 'idle');
        if (result.error === 'unreachable') {
          showToast('Couldn’t send challenge — friend is not reachable right now.', 2600);
        } else if (result.error === 'not_connected') {
          showToast('Connecting to server…', 2000);
        } else if (result.error === 'room_failed') {
          showToast('Could not create a private lobby.', 2200);
        } else if (result.error === 'already_pending') {
          showToast('Finish your current challenge first.', 2000);
        } else if (result.error === 'self' || result.error === 'invalid_target') {
          showToast('Unable to challenge this player.', 2000);
        }
        return;
      }

      setEntry(target.userId, {
        state: 'pending',
        inviteId: result.inviteId,
        expiresAt: result.expiresAt,
      });
      scheduleLocalExpiry(target.userId, result.inviteId, result.expiresAt);
      showToast(`Challenge sent to ${target.username}.`, 2200);
    },
    [
      connect,
      isUnreachable,
      outboundChallenge,
      resetEntry,
      resolveState,
      scheduleLocalExpiry,
      sendFriendChallenge,
      setEntry,
      showToast,
      socket?.connected,
    ],
  );

  useEffect(() => {
    if (!socket) return;

    const onDeclined = (payload: FriendInviteDeclinedPayload) => {
      const challengedUserId = outboundChallenge?.friendUserId;
      if (!challengedUserId) return;
      if (payload.inviteId && outboundChallenge?.inviteId && payload.inviteId !== outboundChallenge.inviteId) {
        return;
      }
      const name = payload.fromUsername ?? outboundChallenge.friendUsername ?? 'Friend';
      showToast(`${name} declined the challenge.`, 2400);
      clearOutboundChallenge();
      resetEntry(challengedUserId, 'declined');
      window.setTimeout(() => resetEntry(challengedUserId, 'idle'), 1200);
    };

    return registerRawSocketEventHandler(
      SOCKET_EVENTS.FRIEND_INVITE_DECLINED,
      onDeclined as RawSocketHandler,
    );
  }, [clearOutboundChallenge, outboundChallenge, resetEntry, showToast, socket]);

  useEffect(
    () => () => {
      for (const timer of expiryTimersRef.current.values()) clearTimeout(timer);
      expiryTimersRef.current.clear();
    },
    [],
  );

  const getChallengeState = useCallback(
    (userId: string): FriendChallengeState => resolveState(userId),
    [resolveState],
  );

  const getChallengeButtonLabel = useCallback(
    (userId: string, presenceStatus: FriendChallengeTarget['presenceStatus']) => {
      if (presenceStatus === 'in_game') return 'In Match';
      if (presenceStatus === 'offline') return 'Offline';
      if (isUnreachable(userId, presenceStatus)) return 'Unavailable';
      return challengeButtonLabel(resolveState(userId));
    },
    [isUnreachable, resolveState],
  );

  const isChallengeDisabled = useCallback(
    (userId: string, presenceStatus: FriendChallengeTarget['presenceStatus']) =>
      isChallengeButtonDisabled(resolveState(userId), presenceStatus, {
        unreachable: isUnreachable(userId, presenceStatus),
        reachabilityKnown: hasReachabilitySnapshot,
      }),
    [hasReachabilitySnapshot, isUnreachable, resolveState],
  );

  return {
    challengeFriend,
    getChallengeState,
    getChallengeButtonLabel,
    isChallengeDisabled,
  };
}
