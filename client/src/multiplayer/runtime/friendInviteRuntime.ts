/** Friend challenge invite popup state owned by multiplayer social flows. */
export type FriendInviteState = {
  inviteId: string;
  fromUsername: string;
  fromUserId: string | null;
  roomCode: string;
  inviteUrl: string;
  matchSummary: string;
} | null;