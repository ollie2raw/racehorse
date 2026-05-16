import type { PresenceStatus } from '../social/socialApi';

export const FRIEND_CHALLENGE_MATCH_SUMMARY = '7-Tile · First to 60 · Untimed';
export const FRIEND_CHALLENGE_EXPIRY_MS = 60_000;

export type FriendChallengeState =
  | 'idle'
  | 'creating'
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'error';

export type FriendChallengeTarget = {
  userId: string;
  username: string;
  presenceStatus: PresenceStatus;
};

export type OutboundChallenge = {
  inviteId: string;
  friendUserId: string;
  friendUsername: string;
  roomCode: string;
  matchSummary: string;
  expiresAt: number;
};

export type FriendInvitePayload = {
  inviteId: string;
  fromUsername: string;
  fromUserId: string | null;
  roomCode: string;
  inviteUrl: string;
  matchSummary: string;
};

export type FriendInviteDeclinedPayload = {
  inviteId?: string;
  fromUsername?: string;
  roomCode?: string;
};

export type SendFriendChallengeResult =
  | {
      ok: true;
      inviteId: string;
      roomCode: string;
      expiresAt: number;
    }
  | {
      ok: false;
      error:
        | 'offline'
        | 'in_game'
        | 'self'
        | 'invalid_target'
        | 'not_connected'
        | 'room_failed'
        | 'already_pending'
        | 'unreachable';
    };

export function makeFriendChallengeInviteId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function challengeButtonLabel(
  state: FriendChallengeState,
  options?: { unreachable?: boolean },
): string {
  if (options?.unreachable) return 'Unavailable';
  switch (state) {
    case 'creating':
      return 'Creating…';
    case 'pending':
      return 'Invited';
    case 'accepted':
      return 'Joining…';
    case 'declined':
    case 'expired':
    case 'error':
    case 'idle':
    default:
      return 'Challenge';
  }
}

export function isChallengeButtonDisabled(
  state: FriendChallengeState,
  presenceStatus: PresenceStatus,
  options?: { unreachable?: boolean; reachabilityKnown?: boolean },
): boolean {
  if (presenceStatus === 'offline' || presenceStatus === 'in_game') return true;
  if (options?.unreachable) return true;
  if (options?.reachabilityKnown === false) return true;
  return state === 'creating' || state === 'pending' || state === 'accepted';
}
