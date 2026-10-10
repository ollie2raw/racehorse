import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppMode } from '../types';

/** After leaving the finished room, let its socket hand-off settle before joining. */
export const NEXT_ROUND_JOIN_SETTLE_MS = 400;

/**
 * "Join Semifinal" / "Join Final" from the post-match screen (Phase 3E). The
 * player is still seated in the finished match, so the finished room is left
 * first, exactly as "View Bracket" leaves it (room:leave, game-over consumed,
 * room session reset). Leaving switches routes and drops the socket, so the
 * join is sent once the player is out of the room (the join itself connects
 * if it has to). Still a tap: nothing here joins on its own.
 */
export function useNextRoundJoin(params: {
  appMode: AppMode;
  joinedRoom: string | null;
  currentMatchId: string | null;
  leaveFinishedMatch: () => void;
  attach: (matchId: string) => void;
}): (matchId: string) => void {
  const { appMode, joinedRoom, currentMatchId, leaveFinishedMatch, attach } = params;
  const pendingRef = useRef<{ matchId: string } | null>(null);
  const [requested, setRequested] = useState(0);

  const join = useCallback(
    (matchId: string) => {
      if (joinedRoom && currentMatchId && currentMatchId !== matchId) {
        pendingRef.current = { matchId };
        leaveFinishedMatch();
        setRequested((n) => n + 1);
        return;
      }
      attach(matchId);
    },
    [attach, currentMatchId, joinedRoom, leaveFinishedMatch],
  );

  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    // The player went somewhere else instead: forget it (never join later on its own).
    if (appMode !== 'tournament' && appMode !== 'multiplayer') {
      pendingRef.current = null;
      return;
    }
    if (joinedRoom || appMode !== 'tournament') return;
    const timer = setTimeout(() => {
      if (pendingRef.current !== pending) return;
      pendingRef.current = null;
      attach(pending.matchId);
    }, NEXT_ROUND_JOIN_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [appMode, attach, joinedRoom, requested]);

  return join;
}
