/**
 * The ladder is three slots again. These pin the parts of the revert that are
 * easy to break: what a new day publishes, that the archived five-slot days
 * still resolve and finalize at *their* length, and where masterChainScore
 * now reads from.
 */
import { describe, expect, it } from 'vitest';
import {
  DAILY_PUZZLE_SLOT_COUNT,
  MAX_DAILY_PUZZLE_SLOT_COUNT,
  findLadderSlotsForAttemptSet,
  findReadyDailyPuzzleLadderSlots,
  isDailyPuzzleAttemptFinalizeReady,
  normalizeDailyPuzzleAttempt,
  resolveActiveSlotForAttempt,
  type DailyPuzzleSlot,
  type DailyPuzzleSlotResult,
} from './dailyPuzzle';
import { DAILY_PUZZLE_LADDER_PROFILES } from './seedDailyPuzzleLadder';

function slot(overrides: Partial<DailyPuzzleSlot> & { slotIndex: DailyPuzzleSlot['slotIndex'] }): DailyPuzzleSlot {
  return {
    id: `slot-${overrides.slotIndex}`,
    puzzleDate: '2026-08-20',
    slotTitle: `Slot ${overrides.slotIndex}`,
    tier: 'quick_line',
    puzzleType: 'one_turn_high_score',
    maxMoves: 1,
    targetScore: 999,
    dealSize: 14,
    slotMaxPoints: 150,
    bestPossibleScore: 25,
    startingBoard: {},
    startingHand: [{ low: 1, high: 1 }],
    objectiveType: 'one_turn_high_score',
    objectivePayload: {},
    setVersion: 1,
    published: true,
    ...overrides,
  };
}

function slotResult(slotIndex: DailyPuzzleSlot['slotIndex'], awardedPoints: number): DailyPuzzleSlotResult {
  return {
    id: `result-${slotIndex}`,
    attemptId: 'attempt-1',
    puzzleId: `slot-${slotIndex}`,
    puzzleDate: '2026-08-20',
    userId: 'user-1',
    slotIndex,
    tier: 'quick_line',
    slotTitle: `Slot ${slotIndex}`,
    puzzleType: 'one_turn_high_score',
    rawScore: awardedPoints,
    awardedPoints,
    bestPossibleScore: 25,
    slotMaxPoints: 150,
    solved: true,
    perfect: false,
    movesUsed: 1,
    elapsedSeconds: 10,
    completedAt: '2026-08-20T12:00:00.000Z',
    submittedLine: [],
    result: {},
  } as DailyPuzzleSlotResult;
}

function attemptRow(overrides: Record<string, unknown>) {
  return {
    id: 'attempt-1',
    puzzle_date: '2026-08-20',
    user_id: 'user-1',
    username: 'Player',
    status: 'started',
    set_version: 1,
    current_slot_index: 1,
    puzzles_completed: 0,
    total_score: 0,
    master_chain_score: 0,
    completed_at: null,
    started_at: '2026-08-20T10:00:00.000Z',
    updated_at: '2026-08-20T10:00:00.000Z',
    review_unlocked: false,
    result: {},
    ...overrides,
  } as Parameters<typeof normalizeDailyPuzzleAttempt>[0];
}

const newDaySlots = [slot({ slotIndex: 1 }), slot({ slotIndex: 2 }), slot({ slotIndex: 3 })];
const archiveDaySlots = [...newDaySlots, slot({ slotIndex: 4 }), slot({ slotIndex: 5 })];

describe('three-slot ladder generation', () => {
  it('generates exactly three slots for a new day', () => {
    expect(DAILY_PUZZLE_SLOT_COUNT).toBe(3);
    expect(DAILY_PUZZLE_LADDER_PROFILES).toHaveLength(DAILY_PUZZLE_SLOT_COUNT);
    expect(DAILY_PUZZLE_LADDER_PROFILES.map((profile) => profile.slotIndex)).toEqual([1, 2, 3]);
  });

  it('resolves a new day to a three-slot ladder', () => {
    const ladder = findReadyDailyPuzzleLadderSlots(newDaySlots);
    expect(ladder?.map((entry) => entry.slotIndex)).toEqual([1, 2, 3]);
  });
});

describe('archived five-slot days', () => {
  it('binds an archive attempt to all five of its own slots', () => {
    const ladder = findLadderSlotsForAttemptSet(archiveDaySlots);
    expect(ladder?.map((entry) => entry.slotIndex)).toEqual([1, 2, 3, 4, 5]);
    expect(MAX_DAILY_PUZZLE_SLOT_COUNT).toBe(5);
  });

  it('finalizes an archive attempt only after five submissions', () => {
    const threeDone = {
      status: 'started' as const,
      result: { slots: [slotResult(1, 60), slotResult(2, 60), slotResult(3, 60)] },
    };
    // Against its own five-slot ladder: not done. Against a new day's: done.
    expect(isDailyPuzzleAttemptFinalizeReady(threeDone, 5)).toBe(false);
    expect(isDailyPuzzleAttemptFinalizeReady(threeDone, 3)).toBe(true);

    const fiveDone = {
      status: 'started' as const,
      result: {
        slots: [slotResult(1, 60), slotResult(2, 60), slotResult(3, 60), slotResult(4, 60), slotResult(5, 60)],
      },
    };
    expect(isDailyPuzzleAttemptFinalizeReady(fiveDone, 5)).toBe(true);
  });

  it('honours the passed count rather than the global constant', () => {
    const twoDone = {
      status: 'started' as const,
      result: { slots: [slotResult(1, 60), slotResult(2, 60)] },
    };
    // The parameter is the whole point of the fix: an explicit 2 must win.
    expect(isDailyPuzzleAttemptFinalizeReady(twoDone, 2)).toBe(true);
    expect(isDailyPuzzleAttemptFinalizeReady(twoDone)).toBe(false);
  });

  it('resumes an archive attempt at its fourth slot, not past the ladder end', () => {
    const attempt = normalizeDailyPuzzleAttempt(
      attemptRow({ current_slot_index: 4, puzzles_completed: 3 }),
      [slotResult(1, 60), slotResult(2, 60), slotResult(3, 60)],
    );
    const active = resolveActiveSlotForAttempt(attempt, archiveDaySlots);
    expect(active?.slotIndex).toBe(4);
  });
});

describe('masterChainScore', () => {
  it('reads from slot 3 on a new three-slot day', () => {
    const attempt = normalizeDailyPuzzleAttempt(
      attemptRow({ current_slot_index: 3, puzzles_completed: 3, status: 'completed' }),
      [slotResult(1, 40), slotResult(2, 50), slotResult(3, 90)],
    );
    expect(attempt.masterChainScore).toBe(90);
    expect(attempt.puzzlesCompleted).toBe(3);
    expect(attempt.totalScore).toBe(180);
  });

  it('still reads from slot 5 on an archived five-slot day', () => {
    const attempt = normalizeDailyPuzzleAttempt(
      attemptRow({ current_slot_index: 5, puzzles_completed: 5, status: 'completed' }),
      [slotResult(1, 40), slotResult(2, 50), slotResult(3, 60), slotResult(4, 70), slotResult(5, 110)],
    );
    expect(attempt.masterChainScore).toBe(110);
    expect(attempt.puzzlesCompleted).toBe(5);
  });
});
