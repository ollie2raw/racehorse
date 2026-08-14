// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  ladderFinalizeFailureMessage,
  ladderSlotRequiresFinalize,
  mergeTodayAfterAttemptUpdate,
  shouldShowPracticeOverlay,
  shouldSkipLadderSlotSubmission,
} from './dailyPuzzleLadderSlotSubmission';
import type { DailyPuzzleAttempt, DailyPuzzleSubmitSlotResponse, DailyPuzzleTodayResponse } from './types';

function makeAttempt(overrides: Partial<DailyPuzzleAttempt> = {}): DailyPuzzleAttempt {
  return {
    id: 'attempt-1',
    puzzleDate: '2024-06-01',
    userId: 'user-1',
    username: 'player',
    status: 'started',
    setVersion: 1,
    currentSlotIndex: 1,
    puzzlesCompleted: 0,
    totalScore: 0,
    masterChainScore: 0,
    completedAt: null,
    startedAt: '2024-06-01T00:00:00Z',
    updatedAt: '2024-06-01T00:00:00Z',
    reviewUnlocked: false,
    practiceMode: 'none',
    result: { slots: [] },
    ...overrides,
  };
}

function makeToday(): DailyPuzzleTodayResponse {
  return {
    ok: true,
    runDate: '2024-06-01',
    setVersion: 1,
    slots: [],
    attemptStatus: 'started',
    attempt: makeAttempt(),
    nextAvailableSlotIndex: 1,
    leaderboardPreview: [],
    legacySinglePuzzleDay: false,
  };
}

describe('ladder slot submission guards', () => {
  it('skips when submit already pending', () => {
    expect(shouldSkipLadderSlotSubmission(true)).toBe(true);
    expect(shouldSkipLadderSlotSubmission(false)).toBe(false);
  });

  it('routes practice mode to overlay only', () => {
    expect(shouldShowPracticeOverlay('practice')).toBe(true);
    expect(shouldShowPracticeOverlay('scored')).toBe(false);
  });

  it('detects finalize requirement from submit response flags', () => {
    const response = {
      ladderCompleted: true,
      requiresCompleteCall: false,
    } as DailyPuzzleSubmitSlotResponse;
    expect(ladderSlotRequiresFinalize(response)).toBe(true);
  });
});

describe('mergeTodayAfterAttemptUpdate', () => {
  it('updates attempt fields and optional finalizeReady', () => {
    const nextAttempt = makeAttempt({ status: 'completed', totalScore: 25 });
    const merged = mergeTodayAfterAttemptUpdate(makeToday(), nextAttempt, false);
    expect(merged.attempt).toEqual(nextAttempt);
    expect(merged.attemptStatus).toBe('completed');
    expect(merged.finalizeReady).toBe(false);
  });
});

describe('ladderFinalizeFailureMessage', () => {
  it('uses error message when available', () => {
    expect(ladderFinalizeFailureMessage(new Error('network'))).toBe('network');
  });

  it('falls back to hub finalize hint', () => {
    expect(ladderFinalizeFailureMessage('x')).toBe(
      'Run scored. Finalize from the hub to save leaderboard progress.',
    );
  });
});