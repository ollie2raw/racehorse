import {
  PUZZLE_RUSH_CONFIG,
  isStageStartOrdinal,
  stageForOrdinal,
  type PuzzleRushConfig,
  type PuzzleRushTier,
} from './config';
import type { PuzzlePoolEntry, PuzzleRushClientPuzzle } from './types';

/**
 * Coarse 0-1000 difficulty, derived from the two signals the seed data
 * actually carries: which tier the puzzle was generated for, and how much
 * scoring headroom its best line has.
 *
 * Tier sets the floor of a band; best_possible_score positions the puzzle
 * inside it. This is intentionally crude — it exists so ramping has something
 * to sort on before any run has produced observed solve rates. Refine from
 * play_count / solve data once runs exist.
 */
export const TIER_DIFFICULTY_BASE: Record<PuzzleRushTier, number> = {
  quick_line: 0,
  tactical_setup: 330,
  master_chain: 660,
};

/** Ordered easiest to hardest; adjacency for the fallback is distance in this list. */
export const TIER_ORDER: PuzzleRushTier[] = ['quick_line', 'tactical_setup', 'master_chain'];

/** Best score at or above this fills a tier's band completely. */
const BEST_SCORE_SATURATION = 120;
const TIER_BAND_WIDTH = 330;

export function deriveDifficultyScore(params: {
  tier: PuzzleRushTier;
  bestPossibleScore: number;
}): number {
  const base = TIER_DIFFICULTY_BASE[params.tier] ?? TIER_DIFFICULTY_BASE.master_chain;
  const headroom = Math.max(0, Math.min(1, params.bestPossibleScore / BEST_SCORE_SATURATION));
  return Math.max(0, Math.min(1000, Math.round(base + headroom * TIER_BAND_WIDTH)));
}

export type RunSelectionFallbackReason =
  /** Right tier, but no unused puzzle left inside the step's difficulty band. */
  | 'band_exhausted'
  /** No unused puzzle left in the step's tier at all; drew from an adjacent tier. */
  | 'tier_exhausted';

export type RunSelectionFallback = {
  ordinal: number;
  /** Stage the ordinal belongs to, so ops can attribute a shortage to a stage. */
  stageKey: string;
  requestedTier: PuzzleRushTier;
  requestedRange: [number, number];
  usedTier: PuzzleRushTier;
  usedDifficulty: number;
  reason: RunSelectionFallbackReason;
};

export type RunSelection = {
  puzzles: PuzzleRushClientPuzzle[];
  /**
   * Every ordinal that could not be filled from its own tier+band. Empty on a
   * healthy pool; a run of these names the tier that needs more content, and
   * the route logs them so we learn that before players feel it.
   */
  fallbacks: RunSelectionFallback[];
  /**
   * True when the pool held fewer distinct puzzles than a full run. The run is
   * served short rather than repeating a puzzle inside one run.
   */
  shortfall: boolean;
  requestedCount: number;
};

/** Penalty ordering: same tier + in band wins, then nearest tier, then nearest difficulty. */
const TIER_DISTANCE_PENALTY = 100_000;
const OUT_OF_BAND_PENALTY = 10_000;

function tierDistance(a: PuzzleRushTier, b: PuzzleRushTier): number {
  return Math.abs(TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b));
}

/**
 * Choose the run's puzzles, ramping difficulty by ordinal.
 *
 * Two hard rules:
 *  - **No puzzle repeats inside a single run.** With the pool's real tier skew
 *    (see docs/ops/puzzle-rush-deploy.md) the thin tiers can be smaller than
 *    their ordinal range, so repeats would otherwise be routine, not rare.
 *  - **Degrade to the nearest adjacent band, visibly.** When a band runs dry we
 *    borrow from the closest tier by difficulty and record it in `fallbacks`,
 *    so an under-supplied tier is observable in ops rather than silently
 *    flattening the difficulty curve.
 *
 * Selection is deterministic given the candidate order the caller supplies —
 * variety comes from how the store queries (least-played first), not from
 * hidden randomness here, which keeps this testable.
 */
export function selectRunPuzzles(params: {
  candidates: PuzzlePoolEntry[];
  config?: PuzzleRushConfig;
}): RunSelection {
  const config = params.config ?? PUZZLE_RUSH_CONFIG;
  const requestedCount = config.run.puzzlesPerRun;
  const available = params.candidates.filter((entry) => entry.enabled && entry.bestPossibleScore > 0);

  if (available.length === 0) {
    return { puzzles: [], fallbacks: [], shortfall: requestedCount > 0, requestedCount };
  }

  const used = new Set<string>();
  const puzzles: PuzzleRushClientPuzzle[] = [];
  const fallbacks: RunSelectionFallback[] = [];

  for (let ordinal = 1; ordinal <= requestedCount; ordinal++) {
    const step = stageForOrdinal(ordinal, config);
    const [minDifficulty, maxDifficulty] = step.difficultyRange;
    const bandMid = (minDifficulty + maxDifficulty) / 2;

    let best: PuzzlePoolEntry | null = null;
    let bestPenalty = Number.POSITIVE_INFINITY;

    for (const entry of available) {
      if (used.has(entry.id)) continue;
      const inBand = entry.difficultyScore >= minDifficulty && entry.difficultyScore <= maxDifficulty;
      const penalty =
        tierDistance(entry.tier, step.tier) * TIER_DISTANCE_PENALTY +
        (inBand ? 0 : OUT_OF_BAND_PENALTY) +
        Math.abs(entry.difficultyScore - bandMid);
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        best = entry;
      }
    }

    // Pool exhausted: serve a short run rather than repeat a puzzle.
    if (!best) break;

    used.add(best.id);

    const sameTier = best.tier === step.tier;
    const inBand =
      best.difficultyScore >= minDifficulty && best.difficultyScore <= maxDifficulty;
    if (!sameTier || !inBand) {
      fallbacks.push({
        ordinal,
        stageKey: step.key,
        requestedTier: step.tier,
        requestedRange: [minDifficulty, maxDifficulty],
        usedTier: best.tier,
        usedDifficulty: best.difficultyScore,
        reason: sameTier ? 'band_exhausted' : 'tier_exhausted',
      });
    }

    puzzles.push({
      ordinal,
      puzzleId: best.id,
      startingBoard: best.startingBoard,
      startingHand: best.startingHand,
      maxMoves: best.maxMoves,
      puzzleType: best.puzzleType,
      tier: best.tier,
      dealSize: best.dealSize,
      targetScore: best.targetScore,
      maxPoints: step.maxPointsPerPuzzle,
      stageKey: step.key,
      stageLabel: step.label,
      isStageStart: isStageStartOrdinal(ordinal, config),
    });
  }

  return {
    puzzles,
    fallbacks,
    shortfall: puzzles.length < requestedCount,
    requestedCount,
  };
}

/** Compact ops summary of a selection's fallbacks, keyed by requested tier. */
export function summarizeSelectionFallbacks(
  selection: RunSelection,
): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const fallback of selection.fallbacks) {
    const key = `${fallback.requestedTier}:${fallback.reason}`;
    summary[key] = (summary[key] ?? 0) + 1;
  }
  return summary;
}
