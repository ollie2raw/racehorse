// ─── Shared wire-level DTOs ────────────────────────────────────
// Single source of truth for payload shapes that must agree between the
// client and the server. Both sides import these types instead of each
// declaring their own local copy — TypeScript's structural checking then
// catches drift at build time (a call site that doesn't match the shared
// shape fails to compile).
//
// See: WAVE 3 contracts consolidation — a prior audit found a client
// `LeaderboardEntry` type with fields (`rating`/`rank`) the server never
// sent (actual shape was `glicko_rating`, no `rank`). That class of bug is
// what this file exists to prevent for daily-fritz, daily-puzzle, and
// room/match action payloads.

import type { PlacementPosition, Tile } from './types';

// ─── Room / match action payload (MOVE / PASS / DRAW) ──────────
// The wire message a client sends to request a game action on a live
// multiplayer room. Kept intentionally loose (fields optional beyond
// `type`) because the server also tolerates legacy payload shapes from
// older clients (e.g. `move.end` as a fallback for `move.position`).

export type RoomActionType = 'DRAW' | 'MOVE' | 'PASS';

export interface RoomActionMovePayload {
  readonly tile: Tile;
  readonly position?: PlacementPosition;
  /** Legacy fallback accepted for backward compatibility with older clients. */
  readonly end?: 'left' | 'right';
}

export interface RoomGameActionPayload {
  readonly type: RoomActionType;
  readonly requestId?: string;
  readonly move?: RoomActionMovePayload;
}

// ─── Daily Fritz set/game DTOs ──────────────────────────────────

export type DailyFritzSetGameNumber = 1 | 2 | 3;
export type DailyFritzDrawWinner = 'you' | 'bot';

export interface DailyFritzSetGameResult {
  gameNumber: DailyFritzSetGameNumber;
  seed: string;
  playerWon: boolean;
  playerScore: number;
  fritzScore: number;
  pointDiff: number;
  movesUsed?: number;
  handsPlayed?: number;
  completedAt: string;
  skunk?: boolean;
  skunkBy?: 'player' | 'fritz';
}

export interface DailyFritzSetResult {
  version: 2;
  format: 'best_of_3';
  playerGamesWon: number;
  fritzGamesWon: number;
  totalPointDiff: number;
  games: DailyFritzSetGameResult[];
  setWinner?: 'player' | 'fritz';
  hasSkunk?: boolean;
  instantSkunk?: boolean;
  skunkGameNumber?: DailyFritzSetGameNumber | null;
  skunkBy?: 'player' | 'fritz' | null;
}

// ─── Daily Puzzle ladder DTOs ───────────────────────────────────

export type DailyPuzzleTier = 'quick_line' | 'tactical_setup' | 'master_chain';
export type DailyPuzzleAttemptStatus = 'none' | 'started' | 'completed';
export type DailyPuzzlePracticeMode = 'none' | 'review' | 'practice';

/** Published ladder length for new days. */
export const DAILY_PUZZLE_SLOT_COUNT = 5 as const;
export const DAILY_PUZZLE_SLOT_INDICES = [1, 2, 3, 4, 5] as const;
/** Older archive days published a three-slot ladder. */
export const LEGACY_DAILY_PUZZLE_SLOT_COUNT = 3 as const;
export const LEGACY_DAILY_PUZZLE_SLOT_INDICES = [1, 2, 3] as const;
export type DailyPuzzleSlotIndex = 1 | 2 | 3 | 4 | 5;

export interface DailyPuzzleSlot {
  id: string;
  puzzleDate: string;
  slotIndex: DailyPuzzleSlotIndex;
  slotTitle: string;
  tier: DailyPuzzleTier;
  puzzleType: string;
  maxMoves: number;
  targetScore: number;
  dealSize: number;
  slotMaxPoints: number;
  bestPossibleScore: number | null;
  startingBoard: unknown;
  startingHand: unknown;
  objectiveType: string;
  objectivePayload: Record<string, unknown>;
  setVersion: number;
  published: boolean;
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
  puzzleType: string;
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

export interface DailyPuzzleLeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  puzzlesCompleted: number;
  totalScore: number;
  masterChainScore: number;
  completedAt: string | null;
  breakdown: Array<{
    slotIndex: DailyPuzzleSlotIndex;
    awardedPoints: number | null;
    perfect: boolean;
    solved: boolean;
  }>;
}
