import { useEffect } from 'react';
import { startGhostMatchSession } from './ghostContracts.ts';

type UseGhostMatchSessionStartArgs = {
  userId: string | null | undefined;
  isGhostMode: boolean;
  isDailyPuzzleRun: boolean;
  matchGameOver: boolean;
  verifiedMatchId: string | null;
  activeLocalMatchId: string;
  opponentUserId: string | null | undefined;
  setVerifiedMatchId: (matchId: string) => void;
};

export function useGhostMatchSessionStart({
  userId,
  isGhostMode,
  isDailyPuzzleRun,
  matchGameOver,
  verifiedMatchId,
  activeLocalMatchId,
  opponentUserId,
  setVerifiedMatchId,
}: UseGhostMatchSessionStartArgs): void {
  useEffect(() => {
    if (!userId || !isGhostMode || isDailyPuzzleRun) return;
    if (matchGameOver || verifiedMatchId) return;
    let cancelled = false;
    void startGhostMatchSession({
      userId,
      localMatchId: activeLocalMatchId,
      opponentUserId,
    })
      .then((response) => {
        if (cancelled) return;
        setVerifiedMatchId(response.matchId);
      })
      .catch((err) => {
        console.warn('[Ghost Match] start failed', err);
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeLocalMatchId,
    isDailyPuzzleRun,
    isGhostMode,
    matchGameOver,
    opponentUserId,
    setVerifiedMatchId,
    userId,
    verifiedMatchId,
  ]);
}