import { useEffect } from 'react';
import {
  fetchDailyPuzzleLeaderboard,
  upsertDailyPuzzleBestScore,
} from '../../dailyPuzzle/api.ts';
import type { BotMatchScreenProps } from '../match/types.ts';
import type { UseBotMatchBootstrapResult } from '../match/hooks/useBotMatchBootstrap.ts';
import type { UseBotMatchRefsResult } from '../match/hooks/useBotMatchRefs.ts';
import type { UseGuidedLessonBootResult } from '../guided/index.ts';
import type { UseDailyFritzRuntimeResult } from '../daily/useDailyFritzRuntime.ts';

export type UseDailyPuzzleLeaderboardSyncArgs = {
  props: BotMatchScreenProps;
  bootstrap: UseBotMatchBootstrapResult;
  refs: UseBotMatchRefsResult;
  guidedBoot: UseGuidedLessonBootResult;
  dailyFritz: UseDailyFritzRuntimeResult;
};

export function useDailyPuzzleLeaderboardSync({
  props,
  bootstrap,
  refs,
  guidedBoot,
  dailyFritz,
}: UseDailyPuzzleLeaderboardSyncArgs) {
  const { dailyPuzzleDate = null, userId = null, username = null } = props;
  const { match, movesUsed, isDailyPuzzleRun } = bootstrap;
  const { isGuidedMode, isAuthoringMode } = guidedBoot;
  const { dailyResultSyncKeyRef } = refs;
  const {
    dailyLeaderboard,
    setDailyLeaderboard,
    dailyLeaderboardLoading,
    setDailyLeaderboardLoading,
    dailyLeaderboardError,
    setDailyLeaderboardError,
  } = dailyFritz;

  useEffect(() => {
    if (!isDailyPuzzleRun || !dailyPuzzleDate || !match.gameOver) return;

    const syncKey = `${dailyPuzzleDate}|${userId ?? 'guest'}|${movesUsed}|${match.players.you.score}`;
    if (dailyResultSyncKeyRef.current === syncKey) return;
    dailyResultSyncKeyRef.current = syncKey;

    let active = true;
    const syncLeaderboard = async () => {
      if (isGuidedMode || isAuthoringMode) return;
      setDailyLeaderboardLoading(true);
      setDailyLeaderboardError(null);
      try {
        if (userId) {
          await upsertDailyPuzzleBestScore({
            puzzleDate: dailyPuzzleDate,
            userId,
            username: username?.trim() || `user_${userId.slice(0, 8)}`,
            score: match.players.you.score,
            movesUsed,
          });
        }
        const rows = await fetchDailyPuzzleLeaderboard(dailyPuzzleDate, 25);
        if (active) setDailyLeaderboard(rows);
      } catch (err) {
        if (active) {
          setDailyLeaderboardError(
            err instanceof Error ? err.message : 'Unable to load leaderboard.',
          );
          setDailyLeaderboard([]);
        }
      } finally {
        if (active) setDailyLeaderboardLoading(false);
      }
    };

    void syncLeaderboard();
    return () => {
      active = false;
    };
  }, [
    dailyPuzzleDate,
    isDailyPuzzleRun,
    match.gameOver,
    match.players.you.score,
    movesUsed,
    userId,
    username,
    isGuidedMode,
    isAuthoringMode,
    dailyResultSyncKeyRef,
    setDailyLeaderboard,
    setDailyLeaderboardLoading,
    setDailyLeaderboardError,
  ]);

  return {
    dailyLeaderboard,
    dailyLeaderboardLoading,
    dailyLeaderboardError,
  };
}

export type UseDailyPuzzleLeaderboardSyncResult = ReturnType<typeof useDailyPuzzleLeaderboardSync>;