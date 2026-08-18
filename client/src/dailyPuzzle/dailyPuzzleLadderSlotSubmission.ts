import {
  completeDailyPuzzleLadder,
  submitDailyPuzzleSlot,
} from './api';
import { recordSolvedStreak } from './streakStorage';
import type {
  DailyPuzzleAttempt,
  DailyPuzzleCompleteResponse,
  DailyPuzzleSlot,
  DailyPuzzleSubmitSlotResponse,
  DailyPuzzleTodayResponse,
} from './types';
import type { PlayStatus } from './dailyPuzzleScreenTypes';

export function shouldSkipLadderSlotSubmission(submitPending: boolean): boolean {
  return submitPending;
}

export function shouldShowPracticeOverlay(playMode: 'scored' | 'practice'): boolean {
  return playMode === 'practice';
}

export function ladderSlotRequiresFinalize(response: DailyPuzzleSubmitSlotResponse): boolean {
  return response.ladderCompleted || response.requiresCompleteCall;
}

export async function runLadderSlotSubmission(params: {
  attempt: DailyPuzzleAttempt;
  activeSlot: DailyPuzzleSlot;
  nextStatus: PlayStatus;
  rawScoreValue: number;
  movesUsed: number;
  elapsedSeconds: number;
  submittedLine: Array<Record<string, unknown>>;
}): Promise<DailyPuzzleSubmitSlotResponse> {
  return submitDailyPuzzleSlot({
    attemptId: params.attempt.id,
    puzzleDate: params.attempt.puzzleDate,
    slotIndex: params.activeSlot.slotIndex,
    puzzleId: params.activeSlot.id,
    rawScore: params.rawScoreValue,
    movesUsed: params.movesUsed,
    elapsedSeconds: params.elapsedSeconds,
    submittedLine: params.submittedLine,
    clientResult: {
      status: params.nextStatus,
      slotTitle: params.activeSlot.slotTitle,
      rawScore: params.rawScoreValue,
    },
  });
}

export function mergeTodayAfterAttemptUpdate(
  current: DailyPuzzleTodayResponse,
  attempt: DailyPuzzleAttempt,
  finalizeReady?: boolean,
): DailyPuzzleTodayResponse {
  return {
    ...current,
    attemptStatus: attempt.status,
    attempt,
    ...(finalizeReady !== undefined ? { finalizeReady } : {}),
  };
}

export async function runLadderFinalizeSubmission(params: {
  attempt: DailyPuzzleAttempt;
}): Promise<DailyPuzzleCompleteResponse> {
  return completeDailyPuzzleLadder({
    attemptId: params.attempt.id,
    puzzleDate: params.attempt.puzzleDate,
  });
}

export function recordRitualStreakIfNeeded(puzzleDate: string, submittedSlotIndex: number): void {
  if (submittedSlotIndex === 1) recordSolvedStreak(puzzleDate);
}

export function recordLadderFinalizeStreak(puzzleDate: string): void {
  recordSolvedStreak(puzzleDate);
}

export function ladderFinalizeFailureMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Run scored. Finalize from the hub to save leaderboard progress.';
}