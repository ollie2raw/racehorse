import { validateDailyPuzzleSubmission } from '../dailyPuzzleSubmissionValidation';
import type { DailyPuzzleSlot } from '../dailyPuzzle';
import {
  PUZZLE_RUSH_CONFIG,
  maxLegitimateRunSeconds,
  stageForOrdinal,
  type PuzzleRushConfig,
} from './config';
import type { PuzzlePoolEntry } from './types';

export type ReportedPuzzle = {
  ordinal: number;
  puzzleId: string;
  submittedLine: Array<Record<string, unknown>>;
  /** What the client believed it scored. Recorded for the audit trail only. */
  clientRawScore: number;
};

export type GradedPuzzle = {
  ordinal: number;
  puzzleId: string;
  rawScore: number;
  awardedPoints: number;
  clientRawScore: number;
  solved: boolean;
  perfect: boolean;
  movesUsed: number;
  bonusSeconds: number;
  submittedLine: Array<Record<string, unknown>>;
  gradingError: string | null;
};

export type RunGrade = {
  puzzles: GradedPuzzle[];
  totalScore: number;
  puzzlesSolved: number;
  bankedBonusSeconds: number;
  valid: boolean;
  invalidatedReason: string | null;
};

/**
 * Awarded points for one solve.
 *
 * Unlike the daily ladder's linear `ratio * slotMaxPoints`, rush applies a
 * convex curve so a near-optimal line is worth meaningfully more than a merely
 * legal one — in a timed mode, "play anything fast" must not beat "play well".
 */
export function calculateRushAwardedPoints(params: {
  rawScore: number;
  bestPossibleScore: number;
  maxPoints: number;
  config?: PuzzleRushConfig;
}): number {
  const config = params.config ?? PUZZLE_RUSH_CONFIG;
  if (!Number.isFinite(params.bestPossibleScore) || params.bestPossibleScore <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, params.rawScore / params.bestPossibleScore));
  if (ratio <= 0) return 0;
  const curved = Math.pow(ratio, config.scoring.curveExponent);
  const base = Math.round(curved * params.maxPoints);
  const perfect = params.rawScore >= params.bestPossibleScore;
  return base + (perfect ? config.scoring.perfectBonusPoints : 0);
}

/**
 * Whether a replayed line counts as a *solve*.
 *
 * Deliberately stricter than the daily ladder's `rawScore > 0`, which rush used
 * until 2026-08-23: in a timed mode, "played one legal tile and moved on" would
 * otherwise post the same 15-solve headline as a run that actually found the
 * lines, and `puzzles_solved` is the leaderboard's tiebreaker.
 *
 * This is a *count* gate, not a scoring gate. `calculateRushAwardedPoints` and
 * `calculateRushBonusSeconds` stay continuous in the same ratio, so a near-miss
 * still earns its partial credit and its banked seconds.
 *
 * A line at or beyond the recorded best always solves: at least one pool row
 * has a stored `best_possible_score` below what its board actually allows, and
 * out-scoring the record must never read as a miss.
 */
export function isRushSolve(params: {
  rawScore: number;
  bestPossibleScore: number;
  config?: PuzzleRushConfig;
}): boolean {
  const config = params.config ?? PUZZLE_RUSH_CONFIG;
  if (!Number.isFinite(params.bestPossibleScore) || params.bestPossibleScore <= 0) return false;
  if (!Number.isFinite(params.rawScore) || params.rawScore <= 0) return false;
  return params.rawScore / params.bestPossibleScore >= config.scoring.solveRatioThreshold;
}

/** Seconds banked by a solve. A zero-score puzzle banks nothing. */
export function calculateRushBonusSeconds(params: {
  rawScore: number;
  bestPossibleScore: number;
  config?: PuzzleRushConfig;
}): number {
  const config = params.config ?? PUZZLE_RUSH_CONFIG;
  if (!Number.isFinite(params.bestPossibleScore) || params.bestPossibleScore <= 0) {
    return -config.clock.missPenaltySeconds;
  }
  const ratio = Math.max(0, Math.min(1, params.rawScore / params.bestPossibleScore));
  if (ratio <= 0) return -config.clock.missPenaltySeconds;
  const { minBonusSeconds, maxBonusSeconds } = config.clock;
  return Math.round(minBonusSeconds + ratio * (maxBonusSeconds - minBonusSeconds));
}

/** Minimal shape `validateDailyPuzzleSubmission` actually reads off a slot. */
function poolEntryAsSlot(entry: PuzzlePoolEntry): DailyPuzzleSlot {
  return {
    startingBoard: entry.startingBoard,
    startingHand: entry.startingHand,
    bestPossibleScore: entry.bestPossibleScore,
  } as unknown as DailyPuzzleSlot;
}

/**
 * Replay every reported puzzle through the real engine and compute the
 * authoritative run result.
 *
 * The client graded optimistically so the clock never waited; this is the
 * settle-up. A line that does not replay legally scores zero rather than
 * failing the whole run — a single bad report is a zero, deliberate score
 * inflation is what invalidates.
 */
export function gradeRun(params: {
  reported: ReportedPuzzle[];
  poolById: Map<string, PuzzlePoolEntry>;
  clientReportedScore: number;
  runDurationSeconds: number;
  config?: PuzzleRushConfig;
}): RunGrade {
  const config = params.config ?? PUZZLE_RUSH_CONFIG;
  const puzzles: GradedPuzzle[] = [];

  const ordered = [...params.reported].sort((a, b) => a.ordinal - b.ordinal);
  const seenOrdinals = new Set<number>();

  for (const report of ordered) {
    const step = stageForOrdinal(report.ordinal, config);
    const entry = params.poolById.get(report.puzzleId);
    const base: GradedPuzzle = {
      ordinal: report.ordinal,
      puzzleId: report.puzzleId,
      rawScore: 0,
      awardedPoints: 0,
      clientRawScore: Math.max(0, Math.round(report.clientRawScore || 0)),
      solved: false,
      perfect: false,
      movesUsed: 0,
      bonusSeconds: 0,
      submittedLine: [],
      gradingError: null,
    };

    if (seenOrdinals.has(report.ordinal)) {
      puzzles.push({ ...base, gradingError: 'duplicate_ordinal' });
      continue;
    }
    seenOrdinals.add(report.ordinal);

    if (!entry) {
      // Reported a puzzle that was never served in this run.
      puzzles.push({ ...base, gradingError: 'unknown_puzzle' });
      continue;
    }

    try {
      const validation = validateDailyPuzzleSubmission({
        slot: poolEntryAsSlot(entry),
        submittedLine: report.submittedLine,
        elapsedSeconds: 0,
      });
      const awardedPoints = calculateRushAwardedPoints({
        rawScore: validation.rawScore,
        bestPossibleScore: entry.bestPossibleScore,
        maxPoints: step.maxPointsPerPuzzle,
        config,
      });
      puzzles.push({
        ...base,
        rawScore: validation.rawScore,
        awardedPoints,
        // Not `validation.solved` — that is the ladder's `rawScore > 0` rule,
        // shared with the daily ladder and deliberately left alone.
        solved: isRushSolve({
          rawScore: validation.rawScore,
          bestPossibleScore: entry.bestPossibleScore,
          config,
        }),
        perfect: validation.perfect,
        movesUsed: validation.movesUsed,
        bonusSeconds: calculateRushBonusSeconds({
          rawScore: validation.rawScore,
          bestPossibleScore: entry.bestPossibleScore,
          config,
        }),
        submittedLine: validation.submittedLine,
      });
    } catch (error) {
      puzzles.push({
        ...base,
        gradingError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const totalScore = puzzles.reduce((sum, puzzle) => sum + puzzle.awardedPoints, 0);
  const puzzlesSolved = puzzles.filter((puzzle) => puzzle.solved).length;
  const bankedBonusSeconds = puzzles.reduce((sum, puzzle) => sum + puzzle.bonusSeconds, 0);

  let invalidatedReason: string | null = null;
  const clientScore = Math.max(0, Math.round(params.clientReportedScore || 0));
  if (clientScore - totalScore > config.antiCheat.scoreTolerancePoints) {
    // Only over-reporting invalidates. A client that under-reports (a dropped
    // update, a refresh) is not cheating and keeps the server's higher total.
    invalidatedReason = 'client_score_mismatch';
  } else if (params.runDurationSeconds > maxLegitimateRunSeconds(bankedBonusSeconds, config)) {
    invalidatedReason = 'run_duration_exceeded';
  } else if (puzzles.some((puzzle) => puzzle.gradingError === 'unknown_puzzle')) {
    invalidatedReason = 'unknown_puzzle_reported';
  }

  return {
    puzzles,
    totalScore,
    puzzlesSolved,
    bankedBonusSeconds,
    valid: invalidatedReason === null,
    invalidatedReason,
  };
}
