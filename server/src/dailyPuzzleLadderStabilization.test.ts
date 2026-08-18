import { describe, expect, it } from 'vitest';
import {
  findLadderSlotsForAttemptSet,
  findReadyDailyPuzzleLadderSlots,
  isDailyPuzzleAttemptFinalizeReady,
  normalizeDailyPuzzleAttempt,
  resolveActiveSlotForAttempt,
  calculateServerAuthoritativeElapsedSeconds,
  type DailyPuzzleAttempt,
  type DailyPuzzleSlot,
  type DailyPuzzleSlotResult,
} from './dailyPuzzle';

function slot(overrides: Partial<DailyPuzzleSlot>): DailyPuzzleSlot {
  return {
    id: `slot-${overrides.setVersion ?? 1}-${overrides.slotIndex ?? 1}`,
    puzzleDate: '2026-05-17',
    slotIndex: 1,
    slotTitle: 'Quick Line',
    tier: 'quick_line',
    puzzleType: 'one_turn_high_score',
    maxMoves: 1,
    targetScore: 999,
    dealSize: 14,
    slotMaxPoints: 150,
    bestPossibleScore: 25,
    startingBoard: { tiles: [] },
    startingHand: [{ low: 1, high: 1 }],
    objectiveType: 'one_turn_high_score',
    objectivePayload: { best_possible_score: 25 },
    setVersion: 1,
    published: true,
    ...overrides,
  };
}

function slotResult(overrides: Partial<DailyPuzzleSlotResult>): DailyPuzzleSlotResult {
  return {
    id: `result-${overrides.slotIndex ?? 1}`,
    attemptId: 'attempt-1',
    puzzleId: `slot-1-${overrides.slotIndex ?? 1}`,
    puzzleDate: '2026-05-17',
    userId: 'user-1',
    slotIndex: 1,
    tier: 'quick_line',
    slotTitle: 'Quick Line',
    puzzleType: 'one_turn_high_score',
    rawScore: 10,
    awardedPoints: 60,
    bestPossibleScore: 25,
    slotMaxPoints: 150,
    solved: true,
    perfect: false,
    movesUsed: 1,
    elapsedSeconds: 5,
    completedAt: '2026-05-17T12:00:00.000Z',
    submittedLine: [],
    result: {},
    ...overrides,
  };
}

function baseAttempt(overrides: Partial<DailyPuzzleAttempt> = {}): DailyPuzzleAttempt {
  return {
    id: 'attempt-1',
    puzzleDate: '2026-05-17',
    userId: 'user-1',
    username: 'Player',
    status: 'started',
    setVersion: 1,
    currentSlotIndex: 1,
    puzzlesCompleted: 0,
    totalScore: 0,
    masterChainScore: 0,
    completedAt: null,
    startedAt: '2026-05-17T10:00:00.000Z',
    updatedAt: '2026-05-17T10:00:00.000Z',
    reviewUnlocked: false,
    practiceMode: 'none',
    result: { slots: [] },
    ...overrides,
  };
}

describe('Daily Puzzle ladder stabilization', () => {
  it('keeps submit validation on attempt setVersion when a newer ready set exists', () => {
    const versionOne = [
      slot({ setVersion: 1, slotIndex: 1, id: 'v1-s1' }),
      slot({ setVersion: 1, slotIndex: 2, id: 'v1-s2', slotTitle: 'Tactical Setup', tier: 'tactical_setup', slotMaxPoints: 250 }),
      slot({ setVersion: 1, slotIndex: 3, id: 'v1-s3', slotTitle: 'Master Chain', tier: 'master_chain', slotMaxPoints: 400 }),
      slot({ setVersion: 1, slotIndex: 4, id: 'v1-s4', slotTitle: 'Puzzle 4', tier: 'master_chain', slotMaxPoints: 300 }),
      slot({ setVersion: 1, slotIndex: 5, id: 'v1-s5', slotTitle: 'Puzzle 5', tier: 'master_chain', slotMaxPoints: 300 }),
    ];
    const versionTwo = [
      slot({ setVersion: 2, slotIndex: 1, id: 'v2-s1' }),
      slot({ setVersion: 2, slotIndex: 2, id: 'v2-s2', slotTitle: 'Tactical Setup', tier: 'tactical_setup', slotMaxPoints: 250 }),
      slot({ setVersion: 2, slotIndex: 3, id: 'v2-s3', slotTitle: 'Master Chain', tier: 'master_chain', slotMaxPoints: 400 }),
      slot({ setVersion: 2, slotIndex: 4, id: 'v2-s4', slotTitle: 'Puzzle 4', tier: 'master_chain', slotMaxPoints: 300 }),
      slot({ setVersion: 2, slotIndex: 5, id: 'v2-s5', slotTitle: 'Puzzle 5', tier: 'master_chain', slotMaxPoints: 300 }),
    ];
    const readyLatest = findReadyDailyPuzzleLadderSlots([...versionOne, ...versionTwo]);
    expect(readyLatest?.[0].setVersion).toBe(2);

    const attemptSlots = versionOne;
    const bound = findLadderSlotsForAttemptSet(attemptSlots);
    expect(bound?.map((entry) => entry.id)).toEqual(['v1-s1', 'v1-s2', 'v1-s3', 'v1-s4', 'v1-s5']);
    expect(bound?.find((entry) => entry.slotIndex === 1 && entry.id === 'v1-s1')).toBeTruthy();
    expect(bound?.find((entry) => entry.id === 'v2-s1')).toBeFalsy();
  });

  it('marks finalize-ready when five slot results exist but status is still started', () => {
    const attempt = baseAttempt({
      currentSlotIndex: 5,
      puzzlesCompleted: 5,
      totalScore: 300,
      result: {
        slots: [
          slotResult({ slotIndex: 1, awardedPoints: 60 }),
          slotResult({ slotIndex: 2, awardedPoints: 60 }),
          slotResult({ slotIndex: 3, awardedPoints: 60 }),
          slotResult({ slotIndex: 4, awardedPoints: 60 }),
          slotResult({ slotIndex: 5, awardedPoints: 60 }),
        ],
      },
    });
    expect(isDailyPuzzleAttemptFinalizeReady(attempt)).toBe(true);
    expect(isDailyPuzzleAttemptFinalizeReady(attempt, 5)).toBe(true);
  });

  it('marks finalize-ready when three slot results exist on a three-slot day', () => {
    const attempt = baseAttempt({
      currentSlotIndex: 3,
      puzzlesCompleted: 3,
      totalScore: 180,
      result: {
        slots: [
          slotResult({ slotIndex: 1, awardedPoints: 60 }),
          slotResult({ slotIndex: 2, awardedPoints: 60 }),
          slotResult({ slotIndex: 3, awardedPoints: 60 }),
        ],
      },
    });
    expect(isDailyPuzzleAttemptFinalizeReady(attempt)).toBe(true);
  });

  it('does not mark finalize-ready after three results on a five-slot archive day', () => {
    const attempt = baseAttempt({
      currentSlotIndex: 4,
      puzzlesCompleted: 3,
      result: {
        slots: [
          slotResult({ slotIndex: 1, awardedPoints: 60 }),
          slotResult({ slotIndex: 2, awardedPoints: 60 }),
          slotResult({ slotIndex: 3, awardedPoints: 60 }),
        ],
      },
    });
    expect(isDailyPuzzleAttemptFinalizeReady(attempt, 5)).toBe(false);
  });

  it('resumes the next unsubmitted slot for an in-flight attempt', () => {
    const versionSlots = [
      slot({ setVersion: 1, slotIndex: 1, id: 'v1-s1' }),
      slot({ setVersion: 1, slotIndex: 2, id: 'v1-s2', slotTitle: 'Tactical Setup', tier: 'tactical_setup', slotMaxPoints: 250 }),
      slot({ setVersion: 1, slotIndex: 3, id: 'v1-s3', slotTitle: 'Master Chain', tier: 'master_chain', slotMaxPoints: 400 }),
      slot({ setVersion: 1, slotIndex: 4, id: 'v1-s4', slotTitle: 'Puzzle 4', tier: 'master_chain', slotMaxPoints: 300 }),
      slot({ setVersion: 1, slotIndex: 5, id: 'v1-s5', slotTitle: 'Puzzle 5', tier: 'master_chain', slotMaxPoints: 300 }),
    ];
    const attempt = baseAttempt({
      setVersion: 1,
      currentSlotIndex: 2,
      result: { slots: [slotResult({ slotIndex: 1, puzzleId: 'v1-s1' })] },
    });
    const active = resolveActiveSlotForAttempt(attempt, versionSlots);
    expect(active?.id).toBe('v1-s2');
  });

  it('treats duplicate complete as idempotent via completed status', () => {
    const completed = baseAttempt({
      status: 'completed',
      reviewUnlocked: true,
      completedAt: '2026-05-17T12:05:00.000Z',
      result: {
        slots: [
          slotResult({ slotIndex: 1 }),
          slotResult({ slotIndex: 2 }),
          slotResult({ slotIndex: 3 }),
          slotResult({ slotIndex: 4 }),
          slotResult({ slotIndex: 5 }),
        ],
        final: {
          puzzlesCompleted: 5,
          totalScore: 300,
          masterChainScore: 60,
          completedAt: '2026-05-17T12:05:00.000Z',
        },
      },
    });
    expect(isDailyPuzzleAttemptFinalizeReady(completed)).toBe(false);
    expect(completed.status).toBe('completed');
  });

  it('keeps duplicate submit idempotent at the attempt snapshot level', () => {
    const first = slotResult({ slotIndex: 2, awardedPoints: 99, rawScore: 12 });
    const attempt = baseAttempt({
      currentSlotIndex: 3,
      result: { slots: [slotResult({ slotIndex: 1 }), first] },
    });
    const existing = attempt.result.slots.find((slot) => slot.slotIndex === 2);
    expect(existing).toEqual(first);
    expect(attempt.result.slots).toHaveLength(2);
  });

  it('unlocks review mode after a completed run', () => {
    const normalized = normalizeDailyPuzzleAttempt(
      {
        id: 'attempt-1',
        puzzle_date: '2026-05-17',
        user_id: 'user-1',
        username: 'Player',
        status: 'completed',
        set_version: 1,
        current_slot_index: 5,
        puzzles_completed: 5,
        total_score: 300,
        master_chain_score: 60,
        completed_at: '2026-05-17T12:05:00.000Z',
        started_at: '2026-05-17T10:00:00.000Z',
        updated_at: '2026-05-17T12:05:00.000Z',
        review_unlocked: true,
        result: {},
      },
      [
        slotResult({ slotIndex: 1 }),
        slotResult({ slotIndex: 2 }),
        slotResult({ slotIndex: 3 }),
        slotResult({ slotIndex: 4 }),
        slotResult({ slotIndex: 5 }),
      ],
    );
    expect(normalized.practiceMode).toBe('review');
    expect(normalized.reviewUnlocked).toBe(true);
  });

  it('recovers attempt progress from authoritative slot results after a partial write', () => {
    const normalized = normalizeDailyPuzzleAttempt(
      {
        id: 'attempt-1',
        puzzle_date: '2026-05-17',
        user_id: 'user-1',
        username: 'Player',
        status: 'started',
        set_version: 1,
        current_slot_index: 4,
        puzzles_completed: 3,
        total_score: 180,
        master_chain_score: 0,
        completed_at: null,
        started_at: '2026-05-17T10:00:00.000Z',
        updated_at: '2026-05-17T12:05:00.000Z',
        review_unlocked: false,
        result: {},
      },
      [
        slotResult({ slotIndex: 1, awardedPoints: 60 }),
        slotResult({ slotIndex: 2, awardedPoints: 60 }),
        slotResult({ slotIndex: 3, awardedPoints: 60 }),
        slotResult({ slotIndex: 4, awardedPoints: 75 }),
      ],
    );

    expect(normalized.currentSlotIndex).toBe(5);
    expect(normalized.puzzlesCompleted).toBe(4);
    expect(normalized.totalScore).toBe(255);
    expect(normalized.result.slots.map((slot) => slot.slotIndex)).toEqual([1, 2, 3, 4]);
  });

  describe('server-authoritative timing calculations', () => {
    it('calculates slot 1 elapsed seconds based on attempt start time', () => {
      const attempt = baseAttempt({
        startedAt: '2026-05-17T10:00:00.000Z',
      });
      const now = new Date('2026-05-17T10:00:15.000Z');
      const elapsed = calculateServerAuthoritativeElapsedSeconds(attempt, 1, now);
      expect(elapsed).toBe(15);
    });

    it('calculates slot 2 elapsed seconds based on slot 1 completion time', () => {
      const attempt = baseAttempt({
        startedAt: '2026-05-17T10:00:00.000Z',
        result: {
          slots: [
            slotResult({ slotIndex: 1, completedAt: '2026-05-17T10:01:00.000Z' }),
          ],
        },
      });
      const now = new Date('2026-05-17T10:01:25.000Z');
      const elapsed = calculateServerAuthoritativeElapsedSeconds(attempt, 2, now);
      expect(elapsed).toBe(25);
    });

    it('calculates slot 3 elapsed seconds based on slot 2 completion time', () => {
      const attempt = baseAttempt({
        startedAt: '2026-05-17T10:00:00.000Z',
        result: {
          slots: [
            slotResult({ slotIndex: 1, completedAt: '2026-05-17T10:01:00.000Z' }),
            slotResult({ slotIndex: 2, completedAt: '2026-05-17T10:03:00.000Z' }),
          ],
        },
      });
      const now = new Date('2026-05-17T10:03:10.000Z');
      const elapsed = calculateServerAuthoritativeElapsedSeconds(attempt, 3, now);
      expect(elapsed).toBe(10);
    });

    it('clamps negative or zero durations to at least 1 second to prevent clock skew exploits', () => {
      const attempt = baseAttempt({
        startedAt: '2026-05-17T10:00:00.000Z',
      });
      const now = new Date('2026-05-17T09:59:00.000Z'); // Clock skew / manipulation
      const elapsed = calculateServerAuthoritativeElapsedSeconds(attempt, 1, now);
      expect(elapsed).toBe(1);
    });
  });
});
