// Matchmaking type definitions — shared across pairing, queue service, persistence,
// and the socket handler. Mirror these on the client in client/src/matchmaking/types.ts.

export type QueuedPlayer = {
  socketId: string;
  userId: string;        // auth.users.id
  username: string;
  rating: number;        // glicko_rating snapshot at join time
  joinedAtMs: number;
  isSim: boolean;
};

export type MatchedPair = {
  a: QueuedPlayer;
  b: QueuedPlayer;
  matchedAtMs: number;
  ratingDelta: number;
};

export type MatchmakingMatchRecord = {
  id: string;
  roomCode: string;
  playerAId: string;
  playerBId: string;
  playerARating: number;
  playerBRating: number;
  status: 'in_progress' | 'completed' | 'abandoned' | 'forfeit';
  winnerId: string | null;
  playerARatingChange: number | null;
  playerBRatingChange: number | null;
  isSim: boolean;
  startedAt: string;
  endedAt: string | null;
};

export type QueueOnlineCount = {
  queued: number;
  online: number;
};

export type QueueStatusEvent = {
  state: 'idle' | 'searching' | 'matched' | 'timeout';
  elapsedMs: number;
  windowWidth: number;
  queueSize: number;
};

export type MatchFoundPayload = {
  roomCode: string;
  opponent: {
    userId: string;
    username: string;
    rating: number;
    isSim: boolean;
  };
  yourRating: number;
  countdownMs: number;
};
