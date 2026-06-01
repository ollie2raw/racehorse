import type { BoardState, Tile } from '../types';

export type DailyPuzzleType =
  | 'reach_target'
  | 'one_turn_high_score'
  | 'setup_and_strike'
  | 'branch_mastery';

export type DailyPuzzleTier = 'quick_line' | 'tactical_setup' | 'master_chain';
export type DailyPuzzleAttemptStatus = 'none' | 'started' | 'completed';
export type DailyPuzzlePracticeMode = 'none' | 'review' | 'practice';

export interface CuratedDailyPuzzleRow {
  id: string;
  puzzle_date: string;
  title: string | null;
  starting_board: unknown;
  starting_hand: unknown;
  max_moves: number;
  target_score: number;
  puzzle_type: string | null;
  deal_size: number | null;
  slot_index?: number | null;
  slot_title?: string | null;
  tier?: string | null;
  slot_max_points?: number | null;
  objective_type?: string | null;
  objective_payload?: Record<string, unknown> | null;
  set_version?: number | null;
  published?: boolean | null;
  created_at: string;
}

export interface CuratedDailyPuzzle {
  id: string;
  puzzleDate: string;
  title: string;
  startingBoard: BoardState;
  startingHand: Tile[];
  maxMoves: number;
  targetScore: number;
  puzzleType: DailyPuzzleType;
  dealSize: number;
  slotIndex?: 1 | 2 | 3;
  slotTitle?: string;
  tier?: DailyPuzzleTier;
  slotMaxPoints?: number;
  objectiveType?: string;
  objectivePayload?: Record<string, unknown>;
  setVersion?: number;
  published?: boolean;
}

export interface PuzzleValidationResult {
  solvable: boolean;
  bestScore: number;
  hasScoringMove: boolean;
  exploredStates: number;
  reason: string;
}

export interface DailyPuzzleSlot {
  id: string;
  puzzleDate: string;
  slotIndex: 1 | 2 | 3;
  slotTitle: 'Quick Line' | 'Tactical Setup' | 'Master Chain';
  tier: DailyPuzzleTier;
  puzzleType: DailyPuzzleType;
  maxMoves: number;
  targetScore: number;
  dealSize: number;
  slotMaxPoints: number;
  bestPossibleScore: number | null;
  startingBoard?: CuratedDailyPuzzle['startingBoard'];
  startingHand?: CuratedDailyPuzzle['startingHand'];
  objectiveType: string;
  objectivePayload: Record<string, unknown>;
}

export interface DailyPuzzleSlotResult {
  id: string;
  attemptId: string;
  puzzleId: string;
  puzzleDate: string;
  userId: string;
  slotIndex: 1 | 2 | 3;
  tier: DailyPuzzleTier;
  slotTitle: string;
  puzzleType: DailyPuzzleType;
  rawScore: number;
  awardedPoints: number;
  bestPossibleScore: number;
  slotMaxPoints: number;
  solved: boolean;
  perfect: boolean;
  movesUsed: number;
  elapsedSeconds: number;
  completedAt: string;
  submittedLine: Array<Record<string, unknown>>;
  result: Record<string, unknown>;
}

export interface DailyPuzzleAttempt {
  id: string;
  puzzleDate: string;
  userId: string;
  username: string | null;
  status: Exclude<DailyPuzzleAttemptStatus, 'none'>;
  setVersion: number;
  currentSlotIndex: 1 | 2 | 3;
  puzzlesCompleted: number;
  totalScore: number;
  masterChainScore: number;
  completedAt: string | null;
  startedAt: string;
  updatedAt: string;
  reviewUnlocked: boolean;
  practiceMode: DailyPuzzlePracticeMode;
  result: {
    slots: DailyPuzzleSlotResult[];
    final?: {
      puzzlesCompleted: number;
      totalScore: number;
      masterChainScore: number;
      completedAt: string;
    };
  };
}

export interface DailyPuzzleTodayResponse {
  ok: true;
  runDate: string;
  setVersion: number;
  slots: DailyPuzzleSlot[];
  /** Slots for the user’s attempt setVersion (when an attempt exists). */
  attemptSlots?: DailyPuzzleSlot[];
  attemptStatus: DailyPuzzleAttemptStatus;
  attempt: DailyPuzzleAttempt | null;
  nextAvailableSlotIndex: 1 | 2 | 3 | null;
  /** All three slots scored but /complete not persisted yet. */
  finalizeReady?: boolean;
  leaderboardPreview: DailyPuzzleLeaderboardRow[];
  legacySinglePuzzleDay: boolean;
}

export interface DailyPuzzleStartResponse {
  ok: true;
  runDate: string;
  attempt: DailyPuzzleAttempt;
  activeSlot: DailyPuzzleSlot;
  nextAvailableSlotIndex: 1 | 2 | 3 | null;
  practiceMode: DailyPuzzlePracticeMode;
  replayed: boolean;
  finalizeReady?: boolean;
}

export interface DailyPuzzleSubmitSlotRequest {
  attemptId: string;
  puzzleDate: string;
  slotIndex: 1 | 2 | 3;
  puzzleId: string;
  rawScore: number;
  movesUsed: number;
  elapsedSeconds: number;
  submittedLine: Array<Record<string, unknown>>;
  clientResult: Record<string, unknown>;
}

export interface DailyPuzzleSubmitSlotResponse {
  ok: true;
  runDate: string;
  attempt: DailyPuzzleAttempt;
  slotResult: DailyPuzzleSlotResult;
  nextAvailableSlotIndex: 2 | 3 | null;
  nextSlot: DailyPuzzleSlot | null;
  ladderCompleted: boolean;
  requiresCompleteCall: boolean;
  replayed: boolean;
}

export interface DailyPuzzleCompleteResponse {
  ok: true;
  runDate: string;
  attempt: DailyPuzzleAttempt;
  leaderboardRank: number | null;
  leaderboardPreview: DailyPuzzleLeaderboardRow[];
  replayed: boolean;
}

export interface DailyPuzzleLeaderboardRow {
  rank: number;
  userId: string;
  username: string;
  puzzlesCompleted: number;
  totalScore: number;
  masterChainScore: number;
  completedAt: string | null;
  breakdown: Array<{
    slotIndex: 1 | 2 | 3;
    awardedPoints: number | null;
    perfect: boolean;
    solved: boolean;
  }>;
}

export interface DailyPuzzleLeaderboardResponse {
  ok: true;
  runDate: string;
  rows: DailyPuzzleLeaderboardRow[];
}
