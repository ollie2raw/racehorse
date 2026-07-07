import { useCallback, useRef } from 'react';
import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import type { PlayStatus } from './dailyPuzzleScreenTypes';
import type { CuratedDailyPuzzle } from './types';
import {
  refreshLegacyLeaderboardAfterResult,
  runLegacyBackendSubmission,
  shouldAllowLegacyBackendSubmission,
  writeLegacyLocalProgress,
} from './dailyPuzzleLegacyResultSubmission';

export type UseDailyPuzzleLegacyGameplayParams = {
  puzzle: CuratedDailyPuzzle | null;
  isArchiveMode: boolean;
  user: User | null;
  profile: UserProfile | null;
  movesUsed: number;
  bestPossibleScore: number;
  streakDays: number;
  setStreakDays: (value: number) => void;
  startTimeRef: React.RefObject<number>;
  requestBestScoreFromWorker: (puzzle: CuratedDailyPuzzle) => Promise<number>;
  refreshLeaderboard: (puzzleDate: string) => void | Promise<void>;
};

export function useDailyPuzzleLegacyGameplay({
  puzzle,
  isArchiveMode,
  user,
  profile,
  movesUsed,
  bestPossibleScore,
  streakDays,
  setStreakDays,
  startTimeRef,
  requestBestScoreFromWorker,
  refreshLeaderboard,
}: UseDailyPuzzleLegacyGameplayParams) {
  const submittedRef = useRef(false);

  const resetSubmissionGuard = useCallback(() => {
    submittedRef.current = false;
  }, []);

  const finalizeResult = useCallback(
    (nextStatus: PlayStatus, solvedMoves: number | null, finalScoreValue: number) => {
      if (!puzzle) return;

      const resolvedStreak = writeLegacyLocalProgress({
        puzzle,
        isArchiveMode,
        nextStatus,
        solvedMoves,
        currentStreakDays: streakDays,
        onStreakDaysUpdated: setStreakDays,
      });

      if (
        shouldAllowLegacyBackendSubmission({
          isArchiveMode,
          userId: user?.id,
          alreadySubmitted: submittedRef.current,
        })
      ) {
        submittedRef.current = true;
        const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startTimeRef.current) / 1000));
        void runLegacyBackendSubmission({
          puzzle,
          nextStatus,
          finalScoreValue,
          solvedMoves,
          movesUsed,
          elapsedSeconds,
          bestPossibleScore,
          resolvedStreak,
          userId: user!.id,
          username: profile?.username ?? user!.email?.split('@')[0] ?? 'Player',
          requestBestScoreFromWorker,
          refreshLeaderboard,
        });
      } else {
        refreshLegacyLeaderboardAfterResult({
          isArchiveMode,
          puzzleDate: puzzle.puzzleDate,
          refreshLeaderboard,
        });
      }
    },
    [
      bestPossibleScore,
      isArchiveMode,
      movesUsed,
      profile?.username,
      puzzle,
      refreshLeaderboard,
      requestBestScoreFromWorker,
      setStreakDays,
      startTimeRef,
      streakDays,
      user,
    ],
  );

  return {
    submittedRef,
    resetSubmissionGuard,
    finalizeResult,
  };
}