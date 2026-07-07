import {
  upsertDailyPuzzleBestScore,
  upsertDailyPuzzleCompletion,
} from './api';
import { readProgress, writeProgress } from './dailyPuzzleScreenHelpers';
import { recordSolvedStreak } from './streakStorage';
import type { PlayStatus } from './dailyPuzzleScreenTypes';
import type { CuratedDailyPuzzle } from './types';

export function resolveLegacyFinalizeSolvedMoves(
  status: PlayStatus,
  nextMoves: number,
): number | null {
  return status === 'SOLVED' ? nextMoves : null;
}

export function shouldAllowLegacyBackendSubmission(params: {
  isArchiveMode: boolean;
  userId: string | null | undefined;
  alreadySubmitted: boolean;
}): boolean {
  return !params.isArchiveMode && Boolean(params.userId) && !params.alreadySubmitted;
}

export function writeLegacyLocalProgress(params: {
  puzzle: CuratedDailyPuzzle;
  isArchiveMode: boolean;
  nextStatus: PlayStatus;
  solvedMoves: number | null;
  currentStreakDays: number;
  onStreakDaysUpdated: (nextStreak: number) => void;
}): number {
  const progress = readProgress(params.puzzle.puzzleDate, params.puzzle.puzzleType);
  let resolvedStreak = params.currentStreakDays;

  if (!params.isArchiveMode && params.nextStatus === 'SOLVED' && params.solvedMoves !== null) {
    const nextStreak = recordSolvedStreak(params.puzzle.puzzleDate);
    params.onStreakDaysUpdated(nextStreak);
    resolvedStreak = nextStreak;
    const nextBest =
      progress.bestMoves === null
        ? params.solvedMoves
        : Math.min(progress.bestMoves, params.solvedMoves);
    writeProgress(params.puzzle.puzzleDate, params.puzzle.puzzleType, {
      ...progress,
      bestMoves: nextBest,
      lastResult: params.nextStatus,
    });
  } else if (!params.isArchiveMode) {
    writeProgress(params.puzzle.puzzleDate, params.puzzle.puzzleType, {
      ...progress,
      lastResult: params.nextStatus,
    });
  }

  return resolvedStreak;
}

export function resolveLegacyBestPossibleScore(
  cachedBestPossibleScore: number,
  workerBestPossibleScore: number,
): number {
  return cachedBestPossibleScore > 0 ? cachedBestPossibleScore : workerBestPossibleScore;
}

export async function runLegacyBackendSubmission(params: {
  puzzle: CuratedDailyPuzzle;
  nextStatus: PlayStatus;
  finalScoreValue: number;
  solvedMoves: number | null;
  movesUsed: number;
  elapsedSeconds: number;
  bestPossibleScore: number;
  resolvedStreak: number;
  userId: string;
  username: string;
  requestBestScoreFromWorker: (puzzle: CuratedDailyPuzzle) => Promise<number>;
  refreshLeaderboard: (puzzleDate: string) => void | Promise<void>;
}): Promise<void> {
  const bestScorePromise = upsertDailyPuzzleBestScore({
    puzzleDate: params.puzzle.puzzleDate,
    userId: params.userId,
    username: params.username,
    score: params.finalScoreValue,
    movesUsed: params.solvedMoves ?? params.movesUsed,
    seconds: params.elapsedSeconds,
  }).catch((err) => {
    console.warn('[DailyPuzzle] best score upsert failed', err);
  });

  const completionPromise =
    params.nextStatus === 'SOLVED'
      ? (async () => {
          const resolvedBestPossibleScore = resolveLegacyBestPossibleScore(
            params.bestPossibleScore,
            await params.requestBestScoreFromWorker(params.puzzle),
          );
          await upsertDailyPuzzleCompletion({
            puzzleDate: params.puzzle.puzzleDate,
            userId: params.userId,
            username: params.username,
            score: params.finalScoreValue,
            bestPossibleScore: resolvedBestPossibleScore,
            perfect: params.finalScoreValue >= resolvedBestPossibleScore,
            currentStreak: params.resolvedStreak,
          });
        })().catch((err) => {
          console.warn('[DailyPuzzle] completion upsert failed', err);
        })
      : Promise.resolve();

  void Promise.allSettled([bestScorePromise, completionPromise]).finally(() => {
    void params.refreshLeaderboard(params.puzzle.puzzleDate);
  });
}

export function refreshLegacyLeaderboardAfterResult(params: {
  isArchiveMode: boolean;
  puzzleDate: string;
  refreshLeaderboard: (puzzleDate: string) => void | Promise<void>;
}): void {
  if (!params.isArchiveMode) {
    void params.refreshLeaderboard(params.puzzleDate);
  }
}