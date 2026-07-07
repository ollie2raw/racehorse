import type { RoomPlayer } from './protocol';
import type { PendingChallenge, PrivateMatchLobbyPhase } from './privateMatchLobbyScreenTypes';

export type FriendChallengeUiState = 'idle' | 'creating' | 'pending';

export function normalizeLobbyUsername(username: string): string {
  return username.replace(/^@+/, '').trim();
}

export function getFriendChallengeUiState(
  friendUsername: string,
  friendUserId: string,
  creatingUserId: string | null,
  pendingChallenge: PendingChallenge | null,
): FriendChallengeUiState {
  if (creatingUserId === friendUserId) return 'creating';
  if (
    pendingChallenge &&
    (pendingChallenge.friendUsername === friendUsername ||
      normalizeLobbyUsername(pendingChallenge.friendUsername) === normalizeLobbyUsername(friendUsername))
  ) {
    return 'pending';
  }
  return 'idle';
}

export function buildPendingInviteState(
  pendingChallenge: PendingChallenge | null,
  guestPresent: boolean,
  now: number,
): {
  pendingInviteActive: boolean;
  pendingInviteName: string | null;
} {
  const pendingInviteActive = Boolean(
    pendingChallenge && pendingChallenge.expiresAt > now && !guestPresent,
  );
  const pendingInviteName = pendingInviteActive
    ? normalizeLobbyUsername(pendingChallenge!.friendUsername)
    : null;
  return { pendingInviteActive, pendingInviteName };
}

export function buildPrivateLobbyFooterHint(params: {
  phase: PrivateMatchLobbyPhase;
  lobbyError: string;
  isRoomHost: boolean;
  playersCount: number;
  pendingInviteActive: boolean;
  pendingInviteName: string | null;
}): string | null {
  const { phase, lobbyError, isRoomHost, playersCount, pendingInviteActive, pendingInviteName } = params;
  if (phase === 'room' && lobbyError === 'waiting_for_ready' && isRoomHost) {
    return 'Waiting for opponent to ready up...';
  }
  if (phase === 'room' && playersCount < 2 && pendingInviteActive && pendingInviteName) {
    return `Waiting for @${pendingInviteName} to accept your challenge…`;
  }
  if (phase === 'room' && playersCount < 2) {
    return 'Waiting for opponent to join…';
  }
  if (phase === 'room' && playersCount === 2 && !isRoomHost) {
    return 'Waiting for host to start the match…';
  }
  return null;
}

export type PrivateLobbyDuelViewModel = {
  inRoom: boolean;
  leftPlainName: string;
  leftCardIsCurrentUser: boolean;
  leftRatingStr: string;
  guestPresent: boolean;
  guestDisplayName: string | null;
};

export function buildPrivateLobbyDuelViewModel(params: {
  phase: PrivateMatchLobbyPhase;
  players: RoomPlayer[];
  you: string | null;
  myUsername: string | null;
  myRating: number | null | undefined;
}): PrivateLobbyDuelViewModel {
  const { phase, players, you, myUsername, myRating } = params;
  const inRoom = phase === 'room';
  const roomHost = players[0];
  const roomGuest = players[1];

  const leftPlainName = (() => {
    const u = inRoom ? roomHost?.username : myUsername;
    return normalizeLobbyUsername(u ?? 'You') || 'You';
  })();

  const leftCardIsCurrentUser = !inRoom || Boolean(roomHost && you && roomHost.id === you);

  const leftRatingStr =
    inRoom && roomHost && you && roomHost.id === you && myRating != null
      ? myRating.toLocaleString()
      : !inRoom && myRating != null
        ? myRating.toLocaleString()
        : '—';

  const guestPresent = inRoom && !!roomGuest?.username;
  const guestDisplayName =
    guestPresent && roomGuest ? normalizeLobbyUsername(roomGuest.username) : null;

  return {
    inRoom,
    leftPlainName,
    leftCardIsCurrentUser,
    leftRatingStr,
    guestPresent,
    guestDisplayName,
  };
}

export function resolveLobbyBackAction(
  phase: PrivateMatchLobbyPhase,
  onLeaveRoom: () => void,
  onBackHome: () => void,
): () => void {
  return phase === 'room' ? onLeaveRoom : onBackHome;
}