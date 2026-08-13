import { useState, useEffect, useCallback } from 'react';
import type { FriendInvitePayload, OutboundChallenge } from './friendChallenge';
import { registerRawSocketEventHandler } from './socketEventBus';

export type UseSocialInviteStateParams = {
  playerCount: number;
  showToast: (msg: string, duration?: number) => void;
};

export type UseSocialInviteStateResult = {
  friendInvite: FriendInvitePayload | null;
  setFriendInvite: React.Dispatch<React.SetStateAction<FriendInvitePayload | null>>;
  outboundChallenge: OutboundChallenge | null;
  setOutboundChallenge: React.Dispatch<React.SetStateAction<OutboundChallenge | null>>;
  clearOutboundChallenge: () => void;
};

export function useSocialInviteState(
  params: UseSocialInviteStateParams,
): UseSocialInviteStateResult {
  const { playerCount, showToast } = params;

  const [friendInvite, setFriendInvite] = useState<FriendInvitePayload | null>(null);
  const [outboundChallenge, setOutboundChallenge] = useState<OutboundChallenge | null>(null);

  const clearOutboundChallenge = useCallback(() => setOutboundChallenge(null), []);

  // Auto-expire incoming invite after 60s
  useEffect(() => {
    if (!friendInvite) return;
    const timer = setTimeout(() => setFriendInvite(null), 60_000);
    return () => clearTimeout(timer);
  }, [friendInvite]);

  // Register socket handlers for friend invite events
  useEffect(() => {
    const unregisterDeclined = registerRawSocketEventHandler(
      'friend:invite:declined',
      (payload) => {
        const data = payload as { inviteId?: string; fromUsername?: string };
        setOutboundChallenge((current) => {
          if (!current) return null;
          if (data.inviteId && current.inviteId !== data.inviteId) return current;
          const name = data.fromUsername ?? current.friendUsername;
          showToast(`${name} declined the challenge.`, 2400);
          return null;
        });
      },
    );

    const unregisterInvited = registerRawSocketEventHandler('friend:invited', (payload) => {
      const data = payload as {
        inviteId?: string;
        fromUsername: string;
        fromUserId?: string | null;
        roomCode: string;
        inviteUrl: string;
        matchSummary?: string;
      };
      setFriendInvite({
        inviteId: String(data.inviteId ?? `${Date.now()}-${data.roomCode}`),
        fromUsername: data.fromUsername,
        fromUserId: data.fromUserId ?? null,
        roomCode: data.roomCode,
        inviteUrl: data.inviteUrl,
        matchSummary: data.matchSummary ?? '7-Tile · First to 60 · Untimed',
      });
    });

    return () => {
      unregisterDeclined();
      unregisterInvited();
    };
  }, [showToast]);

  // Clear outbound challenge when room fills (opponent joined)
  useEffect(() => {
    if (playerCount >= 2 && outboundChallenge) {
      clearOutboundChallenge();
    }
  }, [playerCount, outboundChallenge, clearOutboundChallenge]);

  // Auto-expire outbound challenge at its deadline
  useEffect(() => {
    if (!outboundChallenge) return;
    const delay = Math.max(0, outboundChallenge.expiresAt - Date.now());
    const timer = window.setTimeout(() => {
      setOutboundChallenge((current) => {
        if (!current || current.inviteId !== outboundChallenge.inviteId) return current;
        return null;
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [outboundChallenge]);

  return {
    friendInvite,
    setFriendInvite,
    outboundChallenge,
    setOutboundChallenge,
    clearOutboundChallenge,
  };
}
