import { PUZZLE_RUSH_CONFIG, type PuzzleRushConfig } from './config';
import type { PuzzleRushLeaderboardEntry, PuzzleRushRun } from './types';

/**
 * All-time personal-best board: one row per player, their single best run.
 *
 * Tiebreak order mirrors `buildDailyPuzzleLeaderboard` (dailyPuzzle.ts) so the
 * two boards rank consistently: primary metric desc, secondary metric desc,
 * then earliest achievement, then id for total order.
 *
 * Invalidated and in-progress runs never appear — only `completed`.
 */
export function buildPuzzleRushLeaderboard(
  runs: PuzzleRushRun[],
  config: PuzzleRushConfig = PUZZLE_RUSH_CONFIG,
): PuzzleRushLeaderboardEntry[] {
  const bestByUser = new Map<string, PuzzleRushRun>();

  for (const run of runs) {
    if (run.status !== 'completed') continue;
    const current = bestByUser.get(run.userId);
    if (!current || isBetterRun(run, current)) {
      bestByUser.set(run.userId, run);
    }
  }

  const sorted = [...bestByUser.values()].sort((a, b) => (isBetterRun(a, b) ? -1 : isBetterRun(b, a) ? 1 : 0));

  return sorted.slice(0, config.leaderboard.pageSize).map((run, index) => ({
    rank: index + 1,
    userId: run.userId,
    username: run.username?.trim() || 'Player',
    totalScore: run.totalScore,
    puzzlesSolved: run.puzzlesSolved,
    runId: run.id,
    achievedAt: run.endedAt,
  }));
}

/** Strict "a outranks b". Total order, so sorting is stable across pages. */
function isBetterRun(a: PuzzleRushRun, b: PuzzleRushRun): boolean {
  if (a.totalScore !== b.totalScore) return a.totalScore > b.totalScore;
  if (a.puzzlesSolved !== b.puzzlesSolved) return a.puzzlesSolved > b.puzzlesSolved;
  if (a.endedAt && b.endedAt && a.endedAt !== b.endedAt) return a.endedAt < b.endedAt;
  if (a.endedAt && !b.endedAt) return true;
  if (!a.endedAt && b.endedAt) return false;
  return a.id.localeCompare(b.id) < 0;
}

/**
 * Today's official board: the day's official runs, ranked.
 *
 * Unlike the all-time board this does *not* collapse to one row per user —
 * `is_official` already guarantees that. A run that is completed but not
 * official (a second, for-fun run) never appears here, though it can still set
 * an all-time personal best.
 */
export function buildDailyPuzzleRushLeaderboard(
  runs: PuzzleRushRun[],
  config: PuzzleRushConfig = PUZZLE_RUSH_CONFIG,
): PuzzleRushLeaderboardEntry[] {
  const official = runs.filter((run) => run.status === 'completed' && run.isOfficial);
  const sorted = [...official].sort((a, b) => (isBetterRun(a, b) ? -1 : isBetterRun(b, a) ? 1 : 0));
  return sorted.slice(0, config.leaderboard.pageSize).map((run, index) => ({
    rank: index + 1,
    userId: run.userId,
    username: run.username?.trim() || 'Player',
    totalScore: run.totalScore,
    puzzlesSolved: run.puzzlesSolved,
    runId: run.id,
    achievedAt: run.endedAt,
  }));
}

/** A single player's best completed run, or null if they have none. */
export function findPersonalBestRun(runs: PuzzleRushRun[], userId: string): PuzzleRushRun | null {
  let best: PuzzleRushRun | null = null;
  for (const run of runs) {
    if (run.status !== 'completed' || run.userId !== userId) continue;
    if (!best || isBetterRun(run, best)) best = run;
  }
  return best;
}
