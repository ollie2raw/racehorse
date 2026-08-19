import { computeBestPossiblePuzzleScore } from './generatePuzzles';
import {
  DAILY_PUZZLE_SLOT_COUNT,
  DAILY_PUZZLE_SLOT_INDICES,
  LEGACY_DAILY_PUZZLE_SLOT_COUNT,
  LEGACY_DAILY_PUZZLE_SLOT_INDICES,
  type DailyPuzzleSlotIndex,
} from '@racehorse/game-core';

export type DailyPuzzleTier = 'quick_line' | 'tactical_setup' | 'master_chain';
export type DailyPuzzleAttemptStatus = 'none' | 'started' | 'completed';
export type DailyPuzzlePracticeMode = 'none' | 'review' | 'practice';
export type { DailyPuzzleSlotIndex };
export {
  DAILY_PUZZLE_SLOT_COUNT,
  DAILY_PUZZLE_SLOT_INDICES,
  LEGACY_DAILY_PUZZLE_SLOT_COUNT,
  LEGACY_DAILY_PUZZLE_SLOT_INDICES,
};

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

export interface DailyPuzzleSlotRow {
  id: string;
  puzzle_date: string;
  title: string | null;
  starting_board: unknown;
  starting_hand: unknown;
  max_moves: number | null;
  target_score: number | null;
  puzzle_type: string | null;
  deal_size: number | null;
  slot_index: number | null;
  slot_title: string | null;
  tier: string | null;
  slot_max_points: number | null;
  objective_type: string | null;
  objective_payload: Record<string, unknown> | null;
  set_version: number | null;
  published: boolean | null;
}

export interface DailyPuzzleAttemptRow {
  id: string;
  puzzle_date: string;
  user_id: string;
  username: string | null;
  status: string;
  set_version: number | null;
  current_slot_index: number | null;
  puzzles_completed: number | null;
  total_score: number | null;
  master_chain_score: number | null;
  completed_at: string | null;
  started_at: string | null;
  updated_at: string | null;
  review_unlocked: boolean | null;
  result: Record<string, unknown> | null;
}

export interface DailyPuzzleSlotResultRow {
  id: string;
  attempt_id: string;
  puzzle_id: string;
  puzzle_date: string;
  user_id: string;
  slot_index: number | null;
  tier: string | null;
  slot_title: string | null;
  puzzle_type: string | null;
  raw_score: number | null;
  awarded_points: number | null;
  best_possible_score: number | null;
  slot_max_points: number | null;
  solved: boolean | null;
  perfect: boolean | null;
  moves_used: number | null;
  elapsed_seconds: number | null;
  completed_at: string | null;
  submitted_line: Array<Record<string, unknown>> | null;
  result: Record<string, unknown> | null;
}

function clampSlotIndex(value: number | null | undefined): DailyPuzzleSlotIndex {
  if (value === 2 || value === 3 || value === 4 || value === 5) return value;
  return 1;
}

function normalizeTier(value: string | null | undefined, slotIndex: DailyPuzzleSlotIndex): DailyPuzzleTier {
  if (value === 'quick_line' || value === 'tactical_setup' || value === 'master_chain') return value;
  if (slotIndex === 1) return 'quick_line';
  if (slotIndex === 2) return 'tactical_setup';
  return 'master_chain';
}

function defaultSlotTitle(slotIndex: DailyPuzzleSlotIndex): DailyPuzzleSlot['slotTitle'] {
  if (slotIndex === 1) return 'Quick Hit';
  if (slotIndex === 2) return 'Read';
  if (slotIndex === 3) return 'Master Chain';
  return `Puzzle ${slotIndex}`;
}

function extractBestPossibleScore(
  objectivePayload: Record<string, unknown>,
  targetScore: number,
): number | null {
  const payloadScore = objectivePayload.best_possible_score;
  if (typeof payloadScore === 'number' && Number.isFinite(payloadScore) && payloadScore > 0) {
    return Math.round(payloadScore);
  }
  if (typeof targetScore === 'number' && Number.isFinite(targetScore) && targetScore > 0) {
    return Math.round(targetScore);
  }
  return null;
}

/**
 * Ladder readiness requires a positive best-possible score. Older rows may omit
 * objective_payload.best_possible_score; recompute from board + hand so a valid
 * five-slot day is not stuck in legacy mode.
 */
function inferBestPossibleScoreFromBoard(row: DailyPuzzleSlotRow, targetScore: number): number | null {
  const board = row.starting_board;
  const hand = row.starting_hand;
  if (!board || !Array.isArray(hand) || hand.length === 0) return null;

  const rawType = row.puzzle_type?.trim();
  const puzzleType = rawType === 'setup_and_strike' ? 'setup_and_strike' : 'one_turn_high_score';
  const maxMoves = Number.isFinite(row.max_moves) ? Math.max(1, Math.round(row.max_moves ?? 1)) : 1;
  const dealSize = Number.isFinite(row.deal_size) ? Math.round(row.deal_size ?? 14) : 14;

  try {
    const score = computeBestPossiblePuzzleScore({
      id: row.id,
      puzzleDate: row.puzzle_date,
      title: row.title ?? null,
      startingBoard: board as never,
      startingHand: hand as never,
      maxMoves,
      targetScore,
      puzzleType,
      dealSize,
    });
    if (typeof score === 'number' && Number.isFinite(score) && score > 0) {
      return Math.round(score);
    }
  } catch {
    // Invalid or partial puzzle JSON — leave null.
  }
  return null;
}

export function normalizeDailyPuzzleSlot(row: DailyPuzzleSlotRow): DailyPuzzleSlot {
  const slotIndex = clampSlotIndex(row.slot_index);
  const tier = normalizeTier(row.tier, slotIndex);
  const objectivePayload =
    row.objective_payload && typeof row.objective_payload === 'object' ? row.objective_payload : {};
  const targetScore = Number.isFinite(row.target_score) ? Math.round(row.target_score ?? 0) : 0;
  const bestFromRow = extractBestPossibleScore(objectivePayload, targetScore);
  const bestPossibleScore = bestFromRow ?? inferBestPossibleScoreFromBoard(row, targetScore);
  return {
    id: row.id,
    puzzleDate: row.puzzle_date,
    slotIndex,
    slotTitle: row.slot_title?.trim() || defaultSlotTitle(slotIndex),
    tier,
    puzzleType: row.puzzle_type?.trim() || 'one_turn_high_score',
    maxMoves: Number.isFinite(row.max_moves) ? Math.round(row.max_moves ?? 0) : 0,
    targetScore,
    dealSize: Number.isFinite(row.deal_size) ? Math.round(row.deal_size ?? 0) : 0,
    slotMaxPoints: Number.isFinite(row.slot_max_points) ? Math.round(row.slot_max_points ?? 0) : 0,
    bestPossibleScore,
    startingBoard: row.starting_board ?? null,
    startingHand: row.starting_hand ?? [],
    objectiveType: row.objective_type?.trim() || (row.puzzle_type?.trim() || 'one_turn_high_score'),
    objectivePayload,
    setVersion: Number.isFinite(row.set_version) ? Math.round(row.set_version ?? 1) : 1,
    published: row.published !== false,
  };
}

export function sortDailyPuzzleSlots(slots: DailyPuzzleSlot[]): DailyPuzzleSlot[] {
  return [...slots].sort((a, b) => {
    if (a.setVersion !== b.setVersion) return a.setVersion - b.setVersion;
    if (a.slotIndex !== b.slotIndex) return a.slotIndex - b.slotIndex;
    return a.id.localeCompare(b.id);
  });
}

function hasPlayableLadderData(slot: DailyPuzzleSlot): boolean {
  return (
    Boolean(slot.startingBoard) &&
    Array.isArray(slot.startingHand) &&
    slot.startingHand.length > 0
  );
}

function slotsMatchIndices(
  sorted: DailyPuzzleSlot[],
  indices: readonly DailyPuzzleSlotIndex[],
): boolean {
  return (
    sorted.length === indices.length &&
    indices.every((slotIndex, index) => sorted[index]?.slotIndex === slotIndex)
  );
}

const LADDER_INDEX_CANDIDATES = [
  DAILY_PUZZLE_SLOT_INDICES,
  LEGACY_DAILY_PUZZLE_SLOT_INDICES,
] as const;

function pickLadderFromSortedSlots(
  sorted: DailyPuzzleSlot[],
  options: { requirePublishedMeta: boolean },
): DailyPuzzleSlot[] | null {
  for (const indices of LADDER_INDEX_CANDIDATES) {
    if (!slotsMatchIndices(sorted, indices)) continue;
    if (sorted.some((slot) => !slot.published)) continue;
    if (options.requirePublishedMeta) {
      if (!sorted.every((slot) => slot.slotMaxPoints > 0 && (slot.bestPossibleScore ?? 0) > 0 && hasPlayableLadderData(slot))) {
        continue;
      }
    } else if (!sorted.every(hasPlayableLadderData)) {
      continue;
    }
    return sorted;
  }
  return null;
}

export function findReadyDailyPuzzleLadderSlots(slots: DailyPuzzleSlot[]): DailyPuzzleSlot[] | null {
  if (slots.length < DAILY_PUZZLE_SLOT_COUNT) return null;
  
  const byVersion: Record<number, DailyPuzzleSlot[]> = {};
  for (const slot of slots) {
    if (!byVersion[slot.setVersion]) byVersion[slot.setVersion] = [];
    byVersion[slot.setVersion].push(slot);
  }

  const versions = Object.keys(byVersion).map(Number).sort((a, b) => b - a);

  for (const version of versions) {
    const versionSlots = byVersion[version];
    if (versionSlots.length !== DAILY_PUZZLE_SLOT_COUNT) continue;
    
    const sorted = sortDailyPuzzleSlots(versionSlots);
    if (sorted.some((slot) => !slot.published)) continue;
    if (!DAILY_PUZZLE_SLOT_INDICES.every((slotIndex, index) => sorted[index]?.slotIndex === slotIndex)) continue;
    if (sorted.every((slot) => slot.slotMaxPoints > 0 && (slot.bestPossibleScore ?? 0) > 0)) {
      return sorted;
    }
  }

  return null;
}

export function isDailyPuzzleLadderReady(slots: DailyPuzzleSlot[]): boolean {
  return findReadyDailyPuzzleLadderSlots(slots) !== null;
}

/**
 * Returns the five ladder slots for an attempt's setVersion, or null if incomplete.
 * Does not require full "readiness" metadata (best_possible_score); boards must be present.
 */
export function findLadderSlotsForAttemptSet(
  slots: DailyPuzzleSlot[],
): DailyPuzzleSlot[] | null {
  if (slots.length < DAILY_PUZZLE_SLOT_COUNT) return null;
  const sorted = sortDailyPuzzleSlots(slots);
  if (!DAILY_PUZZLE_SLOT_INDICES.every((slotIndex, index) => sorted[index]?.slotIndex === slotIndex)) {
    return null;
  }
  const hasPlayableData = (slot: DailyPuzzleSlot) =>
    Boolean(slot.startingBoard) &&
    Array.isArray(slot.startingHand) &&
    slot.startingHand.length > 0;
  if (!sorted.every(hasPlayableData)) return null;
  return sorted;
}

/** Stricter readiness for publishing / today endpoint display. */
export function isDailyPuzzleLadderReadyForVersion(slots: DailyPuzzleSlot[]): boolean {
  if (slots.length !== DAILY_PUZZLE_SLOT_COUNT) return false;
  return slots.every(
    (slot) =>
      slot.published &&
      slot.slotMaxPoints > 0 &&
      (slot.bestPossibleScore ?? 0) > 0 &&
      Boolean(slot.startingBoard) &&
      Array.isArray(slot.startingHand) &&
      slot.startingHand.length > 0,
  );
}

export function isDailyPuzzleAttemptFinalizeReady(
  attempt: Pick<DailyPuzzleAttempt, 'status' | 'result'>,
  publishedSlotCount: number = DAILY_PUZZLE_SLOT_COUNT,
): boolean {
  return attempt.status === 'started' && attempt.result.slots.length >= DAILY_PUZZLE_SLOT_COUNT;
}

export function resolveActiveSlotForAttempt(
  attempt: Pick<DailyPuzzleAttempt, 'status' | 'currentSlotIndex' | 'result'>,
  versionSlots: DailyPuzzleSlot[],
): DailyPuzzleSlot | null {
  const ladder = findLadderSlotsForAttemptSet(versionSlots);
  if (!ladder) return null;
  if (attempt.status === 'completed') {
    const reviewIndex = Math.min(Math.max(attempt.result.slots.length, 1), DAILY_PUZZLE_SLOT_COUNT) as DailyPuzzleSlotIndex;
    return ladder.find((slot) => slot.slotIndex === reviewIndex) ?? ladder[ladder.length - 1];
  }
  const submitted = new Set(attempt.result.slots.map((slot) => slot.slotIndex));
  const nextIndex = DAILY_PUZZLE_SLOT_INDICES.find((index) => !submitted.has(index)) ?? attempt.currentSlotIndex;
  return ladder.find((slot) => slot.slotIndex === nextIndex) ?? ladder[0];
}

export function calculateDailyPuzzleAwardedPoints(
  rawScore: number,
  bestPossibleScore: number,
  slotMaxPoints: number,
): number {
  if (!Number.isFinite(bestPossibleScore) || bestPossibleScore <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, rawScore / bestPossibleScore));
  return Math.round(ratio * slotMaxPoints);
}

export function normalizeDailyPuzzleSlotResult(row: DailyPuzzleSlotResultRow): DailyPuzzleSlotResult {
  const slotIndex = clampSlotIndex(row.slot_index);
  return {
    id: row.id,
    attemptId: row.attempt_id,
    puzzleId: row.puzzle_id,
    puzzleDate: row.puzzle_date,
    userId: row.user_id,
    slotIndex,
    tier: normalizeTier(row.tier, slotIndex),
    slotTitle: row.slot_title?.trim() || defaultSlotTitle(slotIndex),
    puzzleType: row.puzzle_type?.trim() || 'one_turn_high_score',
    rawScore: Number.isFinite(row.raw_score) ? Math.round(row.raw_score ?? 0) : 0,
    awardedPoints: Number.isFinite(row.awarded_points) ? Math.round(row.awarded_points ?? 0) : 0,
    bestPossibleScore: Number.isFinite(row.best_possible_score) ? Math.round(row.best_possible_score ?? 0) : 0,
    slotMaxPoints: Number.isFinite(row.slot_max_points) ? Math.round(row.slot_max_points ?? 0) : 0,
    solved: Boolean(row.solved),
    perfect: Boolean(row.perfect),
    movesUsed: Number.isFinite(row.moves_used) ? Math.round(row.moves_used ?? 0) : 0,
    elapsedSeconds: Number.isFinite(row.elapsed_seconds) ? Math.round(row.elapsed_seconds ?? 0) : 0,
    completedAt: row.completed_at ?? new Date(0).toISOString(),
    submittedLine: Array.isArray(row.submitted_line) ? row.submitted_line : [],
    result: row.result && typeof row.result === 'object' ? row.result : {},
  };
}

export function normalizeDailyPuzzleAttempt(
  row: DailyPuzzleAttemptRow,
  slotResults: DailyPuzzleSlotResult[],
): DailyPuzzleAttempt {
  const result = row.result && typeof row.result === 'object' ? row.result : {};
  const practiceMode: DailyPuzzlePracticeMode =
    row.review_unlocked ? 'review' : 'none';
  const completedAt = row.completed_at ?? null;
  const orderedSlotResults = [...slotResults].sort((a, b) => a.slotIndex - b.slotIndex);
  const rowSlotIndex = clampSlotIndex(row.current_slot_index);
  const rawPersistedPuzzlesCompleted = Number.isFinite(row.puzzles_completed)
    ? Math.max(0, Math.round(row.puzzles_completed ?? 0))
    : 0;
  const usesFiveSlotLadder =
    orderedSlotResults.some((slot) => slot.slotIndex > LEGACY_DAILY_PUZZLE_SLOT_COUNT)
    || rowSlotIndex > LEGACY_DAILY_PUZZLE_SLOT_COUNT
    || rawPersistedPuzzlesCompleted > LEGACY_DAILY_PUZZLE_SLOT_COUNT;
  const ladderSlotCount = usesFiveSlotLadder
    ? DAILY_PUZZLE_SLOT_COUNT
    : LEGACY_DAILY_PUZZLE_SLOT_COUNT;
  const ladderIndices = usesFiveSlotLadder
    ? DAILY_PUZZLE_SLOT_INDICES
    : LEGACY_DAILY_PUZZLE_SLOT_INDICES;
  const persistedPuzzlesCompleted = Math.min(ladderSlotCount, rawPersistedPuzzlesCompleted);
  const puzzlesCompleted = orderedSlotResults.length > 0
    ? Math.min(ladderSlotCount, orderedSlotResults.length)
    : persistedPuzzlesCompleted;
  const totalScore = orderedSlotResults.length > 0
    ? orderedSlotResults.reduce((sum, slot) => sum + slot.awardedPoints, 0)
    : Number.isFinite(row.total_score) ? Math.max(0, Math.round(row.total_score ?? 0)) : 0;
  const masterSlotIndex = usesFiveSlotLadder
    ? DAILY_PUZZLE_SLOT_COUNT
    : LEGACY_DAILY_PUZZLE_SLOT_COUNT;
  const masterChainScore = orderedSlotResults.find((slot) => slot.slotIndex === masterSlotIndex)?.awardedPoints
    ?? (Number.isFinite(row.master_chain_score) ? Math.max(0, Math.round(row.master_chain_score ?? 0)) : 0);
  const submittedSlotIndexes = new Set(orderedSlotResults.map((slot) => slot.slotIndex));
  const currentSlotIndex = orderedSlotResults.length > 0
    ? ladderIndices.find((index) => !submittedSlotIndexes.has(index)) ?? ladderIndices[ladderIndices.length - 1]
    : clampSlotIndex(row.current_slot_index);
  return {
    id: row.id,
    puzzleDate: row.puzzle_date,
    userId: row.user_id,
    username: row.username?.trim() || null,
    status: row.status === 'completed' ? 'completed' : 'started',
    setVersion: Number.isFinite(row.set_version) ? Math.round(row.set_version ?? 1) : 1,
    currentSlotIndex,
    puzzlesCompleted,
    totalScore,
    masterChainScore,
    completedAt,
    startedAt: row.started_at ?? new Date(0).toISOString(),
    updatedAt: row.updated_at ?? row.started_at ?? new Date(0).toISOString(),
    reviewUnlocked: Boolean(row.review_unlocked),
    practiceMode,
    result: {
      ...(result as Record<string, unknown>),
      slots: orderedSlotResults,
      ...(completedAt
        ? {
            final: {
              puzzlesCompleted,
              totalScore,
              masterChainScore,
              completedAt,
            },
          }
        : {}),
    },
  };
}

export function buildDailyPuzzleLeaderboard(
  attempts: DailyPuzzleAttempt[],
): DailyPuzzleLeaderboardEntry[] {
  const sorted = [...attempts].sort((a, b) => {
    if (a.puzzlesCompleted !== b.puzzlesCompleted) return b.puzzlesCompleted - a.puzzlesCompleted;
    if (a.totalScore !== b.totalScore) return b.totalScore - a.totalScore;
    if (a.masterChainScore !== b.masterChainScore) return b.masterChainScore - a.masterChainScore;
    if (a.completedAt && b.completedAt && a.completedAt !== b.completedAt) {
      return a.completedAt.localeCompare(b.completedAt);
    }
    if (a.completedAt && !b.completedAt) return -1;
    if (!a.completedAt && b.completedAt) return 1;
    return a.id.localeCompare(b.id);
  });

  return sorted.map((attempt, index) => ({
    rank: index + 1,
    userId: attempt.userId,
    username: attempt.username?.trim() || 'Player',
    puzzlesCompleted: attempt.puzzlesCompleted,
    totalScore: attempt.totalScore,
    masterChainScore: attempt.masterChainScore,
    completedAt: attempt.completedAt,
    breakdown: DAILY_PUZZLE_SLOT_INDICES.map((slotIndex) => {
      const slot = attempt.result.slots.find((entry) => entry.slotIndex === slotIndex);
      return {
        slotIndex: slotIndex as DailyPuzzleSlotIndex,
        awardedPoints: slot?.awardedPoints ?? null,
        perfect: Boolean(slot?.perfect),
        solved: Boolean(slot?.solved),
      };
    }),
  }));
}

export function calculateServerAuthoritativeElapsedSeconds(
  attempt: { startedAt: string; result: { slots: Array<{ slotIndex: number; completedAt: string }> } },
  slotIndex: number,
  now: Date = new Date(),
): number {
  let startTimestamp = attempt.startedAt ? new Date(attempt.startedAt) : now;
  if (slotIndex > 1) {
    const prevSlotIndex = slotIndex - 1;
    const prevSlot = attempt.result.slots.find((s) => s.slotIndex === prevSlotIndex);
    if (prevSlot && prevSlot.completedAt) {
      startTimestamp = new Date(prevSlot.completedAt);
    }
  }
  return Math.max(1, Math.floor((now.getTime() - startTimestamp.getTime()) / 1000));
}
