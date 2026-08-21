import type { PuzzleRushClockConfig, PuzzleRushStage, PuzzleRushStageKey } from './types';

/**
 * Client-side mirrors of the server's clock formula.
 *
 * These drive *feel only*: the banked seconds shown on the HUD and the running
 * tally. The server recomputes everything from replayed lines at `/complete`,
 * and its number is what is recorded. Nothing here can change a score.
 *
 * The client cannot compute a puzzle's *points* at all, because
 * `bestPossibleScore` is deliberately withheld during a run. So the in-run
 * tally is the raw board score, not a points estimate, and the results screen
 * headlines the server's verified total instead.
 */

/**
 * Bonus seconds for a solve.
 *
 * The server's formula is `min + (rawScore / bestPossibleScore) * (max - min)`.
 * The client is deliberately never told `bestPossibleScore`, so it has no
 * honest denominator and **cannot** reproduce that ratio — an earlier version
 * divided by `maxPoints` instead, which is the awarded-points scale (100/200/
 * 300), not the raw board scale (~0-40). That made every solve round down to
 * the floor.
 *
 * So this grants the floor for any scoring solve and nothing for a miss. That
 * is deliberately *conservative*: the client can only ever award less time than
 * the server's replay will credit, so a run can never drift past the duration
 * check into a false `run_duration_exceeded`.
 */
export function estimateBonusSeconds(params: {
  rawScore: number;
  config: Pick<PuzzleRushClockConfig, 'minBonusSeconds' | 'maxBonusSeconds'>;
}): number {
  if (params.rawScore <= 0) return 0;
  return params.config.minBonusSeconds;
}

/** Index of a stage in the run's plan, for "Stage 2 of 3" style readouts. */
export function stagePosition(
  stages: PuzzleRushStage[],
  stageKey: PuzzleRushStageKey,
): { index: number; total: number } {
  const index = stages.findIndex((stage) => stage.key === stageKey);
  return { index: index >= 0 ? index + 1 : 1, total: stages.length || 1 };
}

/** Puzzles completed within a stage, for the segmented progress bar. */
export function stageProgress(
  stage: PuzzleRushStage,
  completedOrdinals: number[],
): { done: number; total: number } {
  const total = Math.max(0, stage.toOrdinal - stage.fromOrdinal + 1);
  const done = completedOrdinals.filter(
    (ordinal) => ordinal >= stage.fromOrdinal && ordinal <= stage.toOrdinal,
  ).length;
  return { done: Math.min(done, total), total };
}

/**
 * The in-run tally is the raw board score, summed — the same number the board
 * awards on each placement. It is *not* the run's points total: points need
 * `bestPossibleScore`, which only the server has. `/complete` returns the real
 * total, and the results screen headlines that.
 */
export function sumRawScore(rawScores: number[]): number {
  return rawScores.reduce((sum, value) => sum + Math.max(0, value), 0);
}

export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}
