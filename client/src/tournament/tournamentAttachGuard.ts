export type TournamentAttachSkipReason =
  | 'no-match'
  | 'socket-disconnected'
  | 'already-pending'
  | 'already-attached'
  | 'backoff';

export const TOURNAMENT_ATTACH_FAILURE_BACKOFF_MS = 30_000;

export function evaluateTournamentAttachGuard(input: {
  matchId: string | null | undefined;
  socketConnected: boolean;
  appMode: string;
  pendingMatchId: string | null;
  attachedMatchId: string | null;
  failedAtByMatchId: Record<string, number>;
  manual?: boolean;
  nowMs?: number;
}): { proceed: boolean; reason: TournamentAttachSkipReason | null } {
  const matchId = input.matchId?.trim() || null;
  if (!matchId) {
    return { proceed: false, reason: 'no-match' };
  }
  if (!input.socketConnected) {
    return { proceed: false, reason: 'socket-disconnected' };
  }
  if (input.pendingMatchId === matchId) {
    return { proceed: false, reason: 'already-pending' };
  }
  if (input.attachedMatchId === matchId && input.appMode === 'multiplayer') {
    return { proceed: false, reason: 'already-attached' };
  }
  if (!input.manual) {
    const failedAt = input.failedAtByMatchId[matchId];
    const now = input.nowMs ?? Date.now();
    if (typeof failedAt === 'number' && now - failedAt < TOURNAMENT_ATTACH_FAILURE_BACKOFF_MS) {
      return { proceed: false, reason: 'backoff' };
    }
  }
  return { proceed: true, reason: null };
}

export function localHandCountFromJoinResponse(
  resp: { you?: unknown; state?: { players?: Record<string, { hand?: unknown[] }> } } | null | undefined,
): number {
  const you = typeof resp?.you === 'string' ? resp.you : '';
  if (!you || !resp?.state?.players) return 0;
  const hand = resp.state.players[you]?.hand;
  return Array.isArray(hand) ? hand.length : 0;
}
