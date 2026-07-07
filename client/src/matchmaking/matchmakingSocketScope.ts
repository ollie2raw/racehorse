import type { MatchmakingSocketScope } from './matchmakingSocketTypes';

/** Mutable scope read by the matchmaking registrar — hooks assign delegates each render. */
export const matchmakingSocketScopeRef: { current: MatchmakingSocketScope } = {
  current: {
    matchmaking: null,
    queueCounts: null,
  },
};