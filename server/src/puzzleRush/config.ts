/**
 * Puzzle Rush tuning table.
 *
 * ALL tunable numbers for the mode live here — clock, bonus-time formula,
 * difficulty ramp, scoring weights, anti-cheat tolerances. Nothing else in the
 * rush code should hard-code a number that a playtest might want to change.
 *
 * Bump `version` whenever a value changes: every run records the
 * `config_version` it was played under, so a leaderboard can be filtered to
 * comparable runs after a re-tune instead of silently mixing eras.
 */

export type PuzzleRushTier = 'quick_line' | 'tactical_setup' | 'master_chain';

/** Stable identifier for a stage. Safe to switch on in the client. */
export type PuzzleRushStageKey = 'warm_up' | 'building' | 'master';

/**
 * One stage of a run.
 *
 * A stage is the unit the player actually feels: a tier change, with a real
 * transition between them. There are exactly three, and the config says so
 * explicitly — an earlier draft used five bands that silently collapsed into
 * three because the pool has no within-tier difficulty spread, which implied a
 * granularity to the client that did not exist.
 */
export type PuzzleRushStage = {
  key: PuzzleRushStageKey;
  /** Player-facing name; the client renders this on the transition beat. */
  label: string;
  /** Inclusive 1-based ordinal range this stage covers. */
  fromOrdinal: number;
  toOrdinal: number;
  tier: PuzzleRushTier;
  /** Inclusive difficulty_score window drawn from for this stage. */
  difficultyRange: [number, number];
  /** Points a perfect solve is worth throughout this stage. */
  maxPointsPerPuzzle: number;
};

export type PuzzleRushConfig = {
  version: number;

  clock: {
    /** Starting clock, in seconds. */
    baseSeconds: number;
    /** Hard ceiling on banked time, so a strong run can't become endless. */
    maxSeconds: number;
    /**
     * Bonus seconds for a solve = `minBonusSeconds` +
     * `scoreRatio * (maxBonusSeconds - minBonusSeconds)`, rounded, where
     * scoreRatio is rawScore / bestPossibleScore clamped to [0, 1].
     * A zero-score puzzle banks nothing.
     */
    minBonusSeconds: number;
    maxBonusSeconds: number;
    /** Seconds deducted for a served puzzle the player scored 0 on. */
    missPenaltySeconds: number;
  };

  run: {
    /**
     * Puzzles shipped in the start payload. The run ends when the clock
     * expires; this is the ceiling on how many a player could get through.
     */
    puzzlesPerRun: number;
    /**
     * The three stages, in order. Must be contiguous and cover
     * 1..`puzzlesPerRun` exactly — `assertStagesCoverRun` enforces that, and a
     * test pins it so this cannot drift back out of sync with the pool.
     */
    stages: PuzzleRushStage[];
  };

  scoring: {
    /**
     * Awarded points = round(scoreRatio ^ curveExponent * maxPointsPerPuzzle).
     * Exponent > 1 rewards near-optimal lines over merely legal ones.
     */
    curveExponent: number;
    /** Flat bonus added when a solve matches best_possible_score exactly. */
    perfectBonusPoints: number;
    /**
     * Share of `best_possible_score` a line must reach to count as a *solve*.
     *
     * This gates the solve **count** only — `awardedPoints` and banked seconds
     * stay continuous in the score ratio either side of it. Set from the pool
     * measured 2026-08-23: achievable scores are dense, not clustered (master
     * puzzles average ~37 distinct reachable totals and the second-best line
     * sits at ~0.97 of the best), so there is no natural gap to sit in and this
     * is a difficulty dial rather than a structural boundary. At 0.8 roughly
     * 5% of random legal master lines clear it, ~12% of tactical, ~24% of
     * quick_line — the warm-up tier is deliberately the most forgiving.
     */
    solveRatioThreshold: number;
  };

  antiCheat: {
    /**
     * Allowed drift between the client-displayed total and the server's
     * replayed total before the run is invalidated. Non-zero only to absorb
     * rounding, not disagreement — the server total is always what is recorded.
     */
    scoreTolerancePoints: number;
    /**
     * Grace added to the theoretical max run duration (base clock + banked
     * bonuses) before wall-clock time is treated as impossible.
     */
    durationGraceSeconds: number;
    /** A run open longer than this is abandoned rather than gradeable. */
    maxRunWallClockSeconds: number;
  };

  leaderboard: {
    /** Bounded scan cap (was mirrored from the retired daily-puzzle ladder's 200-row leaderboard limit). */
    scanLimit: number;
    /** Rows returned to a caller. */
    pageSize: number;
  };
};

export const PUZZLE_RUSH_CONFIG: PuzzleRushConfig = {
  version: 4,

  clock: {
    baseSeconds: 120,
    maxSeconds: 300,
    minBonusSeconds: 1,
    maxBonusSeconds: 5,
    missPenaltySeconds: 0,
  },

  run: {
    puzzlesPerRun: 15,
    /**
     * Three stages over 15 puzzles: 3 / 5 / 7.
     *
     * Bands are set from the real pool measured 2026-08-20:
     *   quick_line     n=106  difficulty 17-80
     *   tactical_setup n=104  difficulty 371-440
     *   master_chain   n=2074 difficulty 743-828
     *
     * Difficulty ramps by *tier* — the pool has no meaningful within-tier
     * spread — so points are flat inside a stage and step at the boundary.
     * The 100/250/500 curve is steeper than the old 100/200/300: with only 3
     * cheap openers, reaching Master has to be where a score is actually made.
     * A full clear is 3·100 + 5·250 + 7·500 = 5,050 before perfect bonuses,
     * and Master alone is 69% of it.
     *
     * Spans need 3 quick_line, 5 tactical_setup, 7 master_chain distinct
     * puzzles — comfortably covered, including by the two thin tiers.
     */
    stages: [
      {
        key: 'warm_up',
        label: 'Warm-Up',
        fromOrdinal: 1,
        toOrdinal: 3,
        tier: 'quick_line',
        difficultyRange: [0, 250],
        maxPointsPerPuzzle: 100,
      },
      {
        key: 'building',
        label: 'Building',
        fromOrdinal: 4,
        toOrdinal: 8,
        tier: 'tactical_setup',
        difficultyRange: [300, 600],
        maxPointsPerPuzzle: 250,
      },
      {
        key: 'master',
        label: 'Master',
        fromOrdinal: 9,
        toOrdinal: 15,
        tier: 'master_chain',
        difficultyRange: [650, 1000],
        maxPointsPerPuzzle: 500,
      },
    ],
  },

  scoring: {
    curveExponent: 1.5,
    perfectBonusPoints: 25,
    solveRatioThreshold: 0.8,
  },

  antiCheat: {
    scoreTolerancePoints: 0,
    durationGraceSeconds: 10,
    maxRunWallClockSeconds: 1800,
  },

  leaderboard: {
    scanLimit: 200,
    pageSize: 50,
  },
};

/** Valid stage keys, for validating observational client telemetry. */
export function isPuzzleRushStageKey(
  value: unknown,
  config: PuzzleRushConfig = PUZZLE_RUSH_CONFIG,
): value is PuzzleRushStageKey {
  return typeof value === 'string' && config.run.stages.some((stage) => stage.key === value);
}

/** The stage governing a given 1-based ordinal. Clamps outside the run range. */
export function stageForOrdinal(
  ordinal: number,
  config: PuzzleRushConfig = PUZZLE_RUSH_CONFIG,
): PuzzleRushStage {
  const stages = config.run.stages;
  let current = stages[0];
  for (const stage of stages) {
    if (ordinal >= stage.fromOrdinal) current = stage;
    else break;
  }
  return current;
}

/** True when this ordinal is the first of its stage — the client's cue point. */
export function isStageStartOrdinal(
  ordinal: number,
  config: PuzzleRushConfig = PUZZLE_RUSH_CONFIG,
): boolean {
  return config.run.stages.some((stage) => stage.fromOrdinal === ordinal);
}

/**
 * Structural invariant: stages must be ordered, contiguous, and cover
 * 1..puzzlesPerRun exactly, with no gap or overlap. Returns the problems found
 * so a test can assert on them rather than throwing at import time.
 */
export function assertStagesCoverRun(
  config: PuzzleRushConfig = PUZZLE_RUSH_CONFIG,
): string[] {
  const problems: string[] = [];
  const stages = config.run.stages;
  if (stages.length === 0) return ['no stages configured'];
  if (stages[0].fromOrdinal !== 1) problems.push('first stage must start at ordinal 1');
  if (stages[stages.length - 1].toOrdinal !== config.run.puzzlesPerRun) {
    problems.push(`last stage must end at ordinal ${config.run.puzzlesPerRun}`);
  }
  for (const stage of stages) {
    if (stage.toOrdinal < stage.fromOrdinal) {
      problems.push(`stage ${stage.key} ends before it begins`);
    }
    const [lo, hi] = stage.difficultyRange;
    if (hi < lo) problems.push(`stage ${stage.key} has an inverted difficulty range`);
  }
  for (let i = 1; i < stages.length; i++) {
    const previous = stages[i - 1];
    const stage = stages[i];
    if (stage.fromOrdinal !== previous.toOrdinal + 1) {
      problems.push(
        `stage ${stage.key} starts at ${stage.fromOrdinal}, expected ${previous.toOrdinal + 1}`,
      );
    }
  }
  return problems;
}

/**
 * Theoretical maximum wall-clock a run could legitimately last: the base clock
 * plus every bonus second the recorded solves banked, capped by `maxSeconds`.
 */
export function maxLegitimateRunSeconds(
  bankedBonusSeconds: number,
  config: PuzzleRushConfig = PUZZLE_RUSH_CONFIG,
): number {
  const banked = Math.max(0, bankedBonusSeconds);
  return Math.min(config.clock.maxSeconds, config.clock.baseSeconds + banked)
    + config.antiCheat.durationGraceSeconds;
}
