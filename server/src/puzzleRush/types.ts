import { isPuzzleRushStageKey, type PuzzleRushStageKey, type PuzzleRushTier } from './config';

/** A pool row as the server holds it. `bestPossibleScore` never leaves the server mid-run. */
export type PuzzlePoolEntry = {
  id: string;
  source: string;
  sourcePuzzleId: string | null;
  startingBoard: unknown;
  startingHand: unknown;
  maxMoves: number;
  puzzleType: string;
  tier: PuzzleRushTier;
  dealSize: number;
  targetScore: number;
  bestPossibleScore: number;
  difficultyScore: number;
  playCount: number;
  enabled: boolean;
};

/**
 * What a puzzle looks like in the run-start payload.
 *
 * Deliberately omits `bestPossibleScore`, `difficultyScore` and `playCount`:
 * shipping the best score would let a client compute the optimal line without
 * solving anything, which is the entire difficulty of the mode.
 */
export type PuzzleRushClientPuzzle = {
  ordinal: number;
  puzzleId: string;
  startingBoard: unknown;
  startingHand: unknown;
  maxMoves: number;
  puzzleType: string;
  tier: PuzzleRushTier;
  dealSize: number;
  targetScore: number;
  /** Points a perfect solve is worth here — needed for the HUD, safe to send. */
  maxPoints: number;
  /** Stage this ordinal belongs to. The client drives its transition beat off these. */
  stageKey: PuzzleRushStageKey;
  stageLabel: string;
  /** True on the first ordinal of a stage — the exact cue point. */
  isStageStart: boolean;
};

export type PuzzleRushRunStatus = 'in_progress' | 'completed' | 'invalidated';

export type PuzzleRushRun = {
  id: string;
  userId: string;
  username: string | null;
  status: PuzzleRushRunStatus;
  startedAt: string;
  endedAt: string | null;
  totalScore: number;
  puzzlesSolved: number;
  clientReportedScore: number;
  invalidatedReason: string | null;
  configVersion: number;
  /** Pacific calendar date this run belongs to (same boundary as the ladder). */
  runDate: string | null;
  /** First run of that day for this user. Governs the daily leaderboard only. */
  isOfficial: boolean;
};

/** A puzzle the client reported during a run, before/after server grading. */
export type PuzzleRushRunPuzzle = {
  id: string;
  runId: string;
  puzzleId: string;
  ordinal: number;
  rawScore: number;
  awardedPoints: number;
  clientRawScore: number;
  solved: boolean;
  perfect: boolean;
  movesUsed: number;
  bonusSeconds: number;
  submittedLine: Array<Record<string, unknown>>;
  clientReportedAt: string;
  gradedAt: string | null;
  gradingError: string | null;
  /**
   * Observational only: the stage the client believed it was in when it
   * reported. Never read by grading, scoring, or invalidation.
   */
  stageReachedKey: PuzzleRushStageKey | null;
};

export type PuzzleRushLeaderboardEntry = {
  rank: number;
  userId: string;
  username: string;
  totalScore: number;
  puzzlesSolved: number;
  runId: string;
  achievedAt: string | null;
};

export type PuzzlePoolRow = {
  id: string;
  source: string | null;
  source_puzzle_id: string | null;
  starting_board: unknown;
  starting_hand: unknown;
  max_moves: number | null;
  puzzle_type: string | null;
  tier: string | null;
  deal_size: number | null;
  target_score: number | null;
  best_possible_score: number | null;
  difficulty_score: number | null;
  play_count: number | null;
  enabled: boolean | null;
};

export type RushRunRow = {
  id: string;
  user_id: string;
  username: string | null;
  status: string | null;
  started_at: string;
  ended_at: string | null;
  total_score: number | null;
  puzzles_solved: number | null;
  client_reported_score: number | null;
  invalidated_reason: string | null;
  config_version: number | null;
  run_date?: string | null;
  is_official?: boolean | null;
};

export type RushRunPuzzleRow = {
  id: string;
  run_id: string;
  puzzle_id: string;
  ordinal: number;
  raw_score: number | null;
  awarded_points: number | null;
  client_raw_score: number | null;
  solved: boolean | null;
  perfect: boolean | null;
  moves_used: number | null;
  bonus_seconds: number | null;
  submitted_line: unknown;
  client_reported_at: string;
  graded_at: string | null;
  grading_error: string | null;
  stage_reached_key?: string | null;
};

function normalizeTier(value: string | null | undefined): PuzzleRushTier {
  if (value === 'quick_line' || value === 'tactical_setup' || value === 'master_chain') return value;
  return 'master_chain';
}

function int(value: unknown, fallback: number): number {
  return Number.isFinite(value) ? Math.round(value as number) : fallback;
}

export function normalizePuzzlePoolEntry(row: PuzzlePoolRow): PuzzlePoolEntry {
  return {
    id: row.id,
    source: row.source?.trim() || 'daily_puzzles',
    sourcePuzzleId: row.source_puzzle_id ?? null,
    startingBoard: row.starting_board,
    startingHand: row.starting_hand,
    maxMoves: int(row.max_moves, 1),
    puzzleType: row.puzzle_type?.trim() || 'one_turn_high_score',
    tier: normalizeTier(row.tier),
    dealSize: int(row.deal_size, 14),
    targetScore: int(row.target_score, 999),
    bestPossibleScore: Math.max(0, int(row.best_possible_score, 0)),
    difficultyScore: Math.max(0, int(row.difficulty_score, 0)),
    playCount: Math.max(0, int(row.play_count, 0)),
    enabled: row.enabled !== false,
  };
}

export function normalizeRushRun(row: RushRunRow): PuzzleRushRun {
  const status: PuzzleRushRunStatus =
    row.status === 'completed' || row.status === 'invalidated' ? row.status : 'in_progress';
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username?.trim() || null,
    status,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? null,
    totalScore: Math.max(0, int(row.total_score, 0)),
    puzzlesSolved: Math.max(0, int(row.puzzles_solved, 0)),
    clientReportedScore: Math.max(0, int(row.client_reported_score, 0)),
    invalidatedReason: row.invalidated_reason ?? null,
    configVersion: int(row.config_version, 1),
    runDate: typeof row.run_date === 'string' ? row.run_date : null,
    isOfficial: row.is_official === true,
  };
}

export function normalizeRushRunPuzzle(row: RushRunPuzzleRow): PuzzleRushRunPuzzle {
  return {
    id: row.id,
    runId: row.run_id,
    puzzleId: row.puzzle_id,
    ordinal: int(row.ordinal, 1),
    rawScore: Math.max(0, int(row.raw_score, 0)),
    awardedPoints: Math.max(0, int(row.awarded_points, 0)),
    clientRawScore: Math.max(0, int(row.client_raw_score, 0)),
    solved: Boolean(row.solved),
    perfect: Boolean(row.perfect),
    movesUsed: Math.max(0, int(row.moves_used, 0)),
    bonusSeconds: int(row.bonus_seconds, 0),
    submittedLine: Array.isArray(row.submitted_line)
      ? (row.submitted_line as Array<Record<string, unknown>>)
      : [],
    clientReportedAt: row.client_reported_at,
    gradedAt: row.graded_at ?? null,
    gradingError: row.grading_error ?? null,
    stageReachedKey: isPuzzleRushStageKey(row.stage_reached_key)
      ? row.stage_reached_key
      : null,
  };
}
