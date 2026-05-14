// Mirror of server/src/matchmaking/types.ts (client subset).

export type QueueUiState = 'idle' | 'searching' | 'matched' | 'in-match' | 'post-match' | 'timeout';

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

export type QueueStatusEvent = {
  state: 'idle' | 'searching' | 'matched' | 'timeout';
  elapsedMs: number;
  windowWidth: number;
  queueSize: number;
};

export type OnlineCountEvent = {
  online: number;
  queued: number;
};
