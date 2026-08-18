import type { BoardState, Tile } from '../types';
// Single source of truth for these shapes lives in @racehorse/game-core's
// dtoContracts module, imported by both client and server, so the two sides
// cannot silently drift apart (a prior audit caught a client LeaderboardEntry
// type with fields the server never sent — this import is what prevents a
// repeat of that bug class).
import {
  DAILY_PUZZLE_SLOT_COUNT,
  DAILY_PUZZLE_SLOT_INDICES,
  LEGACY_DAILY_PUZZLE_SLOT_COUNT,
  LEGACY_DAILY_PUZZLE_SLOT_INDICES,
  type DailyPuzzleAttemptStatus,
  type DailyPuzzleLeaderboardEntry,
  type DailyPuzzlePracticeMode,
  type DailyPuzzleSlotIndex,
  type DailyPuzzleTier,
} from '@racehorse/game-core';

export {
  DAILY_PUZZLE_SLOT_COUNT,
  DAILY_PUZZLE_SLOT_INDICES,
  LEGACY_DAILY_PUZZLE_SLOT_COUNT,
  LEGACY_DAILY_PUZZLE_SLOT_INDICES,
  type DailyPuzzleAttemptStatus,
  type DailyPuzzlePracticeMode,
  type DailyPuzzleSlotIndex,
  type DailyPuzzleTier,
};

export type DailyPuzzleType =
  | 'reach_target'
  | 'one_turn_high_score'
  | 'setup_and_strike'
  | 'branch_mastery';

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
  slotIndex?: DailyPuzzleSlotIndex;
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
  slotIndex: DailyPuzzleSlotIndex;
  slotTitle: string;
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
  slotIndex: DailyPuzzleSlotIndex;
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
  currentSlotIndex: DailyPuzzleSlotIndex;
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
  nextAvailableSlotIndex: DailyPuzzleSlotIndex | null;
  /** All published slots scored but /complete not persisted yet. */
  finalizeReady?: boolean;
  leaderboardPreview: DailyPuzzleLeaderboardRow[];
  legacySinglePuzzleDay: boolean;
}

export interface DailyPuzzleStartResponse {
  ok: true;
  runDate: string;
  attempt: DailyPuzzleAttempt;
  activeSlot: DailyPuzzleSlot;
  nextAvailableSlotIndex: DailyPuzzleSlotIndex | null;
  practiceMode: DailyPuzzlePracticeMode;
  replayed: boolean;
  finalizeReady?: boolean;
}

export interface DailyPuzzleSubmitSlotRequest {
  attemptId: string;
  puzzleDate: string;
  slotIndex: DailyPuzzleSlotIndex;
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
  nextAvailableSlotIndex: DailyPuzzleSlotIndex | null;
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

// Identical shape to the server's DailyPuzzleLeaderboardEntry — single-sourced
// from @racehorse/game-core so client and server can't diverge on field names.
export type DailyPuzzleLeaderboardRow = DailyPuzzleLeaderboardEntry;

export interface DailyPuzzleLeaderboardResponse {
  ok: true;
  runDate: string;
  rows: DailyPuzzleLeaderboardRow[];
}
