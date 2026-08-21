import type { BoardState, Tile } from '../types';

/**
 * Wire types for `/api/puzzle-rush/*`.
 *
 * Mirrors `server/src/puzzleRush/types.ts`. Note what is *not* here: the
 * server never sends `bestPossibleScore`, `difficultyScore`, or `playCount`
 * for an in-flight run — shipping the best score would let a client derive
 * optimal play without solving anything. The client's own scoring is therefore
 * always an estimate; the authoritative total comes back from `/complete`.
 */

export type PuzzleRushStageKey = 'warm_up' | 'building' | 'master';

export type PuzzleRushTier = 'quick_line' | 'tactical_setup' | 'master_chain';

export type PuzzleRushRunStatus = 'in_progress' | 'completed' | 'invalidated';

export interface PuzzleRushPuzzle {
  ordinal: number;
  puzzleId: string;
  startingBoard: BoardState;
  startingHand: Tile[];
  maxMoves: number;
  puzzleType: string;
  tier: PuzzleRushTier;
  dealSize: number;
  targetScore: number;
  /** Points a perfect solve is worth here. Safe to show; it is not the answer. */
  maxPoints: number;
  stageKey: PuzzleRushStageKey;
  stageLabel: string;
  /** True on the first ordinal of a stage — the transition cue point. */
  isStageStart: boolean;
}

export interface PuzzleRushStage {
  key: PuzzleRushStageKey;
  label: string;
  fromOrdinal: number;
  toOrdinal: number;
  maxPointsPerPuzzle: number;
  /** Puzzles actually served in this stage for *this* run, not the config's intent. */
  puzzleCount: number;
}

export interface PuzzleRushRun {
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
}

export interface PuzzleRushClockConfig {
  version: number;
  baseSeconds: number;
  maxSeconds: number;
  minBonusSeconds: number;
  maxBonusSeconds: number;
  puzzlesPerRun: number;
}

export interface PuzzleRushStartResponse {
  ok: true;
  replayed: boolean;
  run: PuzzleRushRun;
  puzzles: PuzzleRushPuzzle[];
  selection: {
    requested: number;
    served: number;
    shortfall: boolean;
    fallbackCount: number;
  };
  stages: PuzzleRushStage[];
  config: PuzzleRushClockConfig;
}

export interface PuzzleRushReportRequest {
  runId: string;
  puzzleId: string;
  ordinal: number;
  clientRawScore: number;
  submittedLine: Array<Record<string, unknown>>;
  /** Observational telemetry so drop-off can be measured per stage. */
  stageReachedKey: PuzzleRushStageKey;
}

export interface PuzzleRushReportResponse {
  ok: true;
  recorded: { ordinal: number; puzzleId: string };
}

export interface PuzzleRushCompleteResponse {
  ok: true;
  replayed: boolean;
  run: PuzzleRushRun;
  /** The server's replayed total. This is the real number. */
  authoritativeScore?: number;
  clientReportedScore?: number;
  invalidated?: boolean;
  invalidatedReason?: string | null;
}

/** One puzzle's optimistic client-side result, held until the run ends. */
export interface RushPuzzleResult {
  ordinal: number;
  puzzleId: string;
  stageKey: PuzzleRushStageKey;
  /** Board score for this puzzle. The client's only honest scoring signal. */
  rawScore: number;
  bonusSeconds: number;
  solved: boolean;
  /** The line as played, forwarded verbatim for the server's replay. */
  submittedLine: Array<Record<string, unknown>>;
}

export interface PuzzleRushTodayResponse {
  ok: true;
  runDate: string;
  personalBest: number | null;
  streakDays: number;
  playedToday: boolean;
  officialRunComplete: boolean;
}

/**
 * One board row. Mirrors the server's `PuzzleRushLeaderboardEntry`
 * (server/src/puzzleRush/types.ts) — the shape `buildPuzzleRushLeaderboard`
 * and `buildDailyPuzzleRushLeaderboard` emit.
 */
export interface PuzzleRushLeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  totalScore: number;
  puzzlesSolved: number;
  runId: string;
  achievedAt: string | null;
}

export interface PuzzleRushLeaderboardResponse {
  ok: true;
  runDate: string;
  /** Today's official runs. */
  daily: PuzzleRushLeaderboardEntry[];
  /** All-time personal bests, one row per player. */
  leaderboard: PuzzleRushLeaderboardEntry[];
  personalBest: PuzzleRushRun | null;
}
