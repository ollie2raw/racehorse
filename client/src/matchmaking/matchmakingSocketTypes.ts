import type { MatchFoundPayload, OnlineCountEvent } from './types';

/** Queue search lifecycle — owned by useMatchmaking, invoked by the registrar only. */
export type MatchmakingSocketDelegates = {
  onQueueOnline: (evt: OnlineCountEvent) => void;
  onQueueMatched: (payload: MatchFoundPayload) => void;
  onQueueTimeout: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
};

/** Read-only queue depth widget — owned by useQueueCounts, invoked by the registrar only. */
export type QueueCountSocketDelegates = {
  onQueueOnline: (evt: OnlineCountEvent) => void;
  onConnect: () => void;
};

export type MatchmakingSocketScope = {
  matchmaking: MatchmakingSocketDelegates | null;
  queueCounts: QueueCountSocketDelegates | null;
};