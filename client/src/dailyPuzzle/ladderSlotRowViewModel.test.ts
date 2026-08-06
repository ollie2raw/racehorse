import { describe, expect, it } from 'vitest';
import { getLadderPuzzleCardState } from './ladderHelpers';
import {
  buildLadderSlotBreakdown,
  buildLadderSlotRows,
  computeLadderTotalPoints,
} from './ladderSlotRowViewModel';
import type { DailyPuzzleSlot, DailyPuzzleSlotResult } from './types';

function makeSlot(overrides: Partial<DailyPuzzleSlot> = {}): DailyPuzzleSlot {
  return {
    id: 'slot-1',
    puzzleDate: '2024-06-01',
    slotIndex: 1,
    slotTitle: 'Quick Line',
    tier: 'quick_line',
    puzzleType: 'reach_target',
    maxMoves: 3,
    targetScore: 30,
    dealSize: 7,
    slotMaxPoints: 10,
    bestPossibleScore: 30,
    startingBoard: { mainLine: [], leftEnd: 0, rightEnd: 0, leftEndIsDouble: false, rightEndIsDouble: false, hubDoubles: [] },
    startingHand: [{ low: 1, high: 2 }],
    objectiveType: 'reach_target',
    objectivePayload: {},
    ...overrides,
  };
}

function makeSlotResult(overrides: Partial<DailyPuzzleSlotResult> = {}): DailyPuzzleSlotResult {
  return {
    id: 'result-1',
    attemptId: 'attempt-1',
    puzzleId: 'slot-1',
    puzzleDate: '2024-06-01',
    userId: 'user-1',
    slotIndex: 1,
    tier: 'quick_line',
    slotTitle: 'Quick Line',
    puzzleType: 'reach_target',
    rawScore: 25,
    awardedPoints: 8,
    bestPossibleScore: 10,
    slotMaxPoints: 10,
    solved: true,
    perfect: false,
    movesUsed: 2,
    elapsedSeconds: 45,
    completedAt: '2024-06-01T12:00:00Z',
    submittedLine: [],
    result: {},
    ...overrides,
  };
}

describe('buildLadderSlotBreakdown', () => {
  it('returns five chips with dashes when no results exist', () => {
    const chips = buildLadderSlotBreakdown([]);
    expect(chips).toHaveLength(5);
    expect(chips.map((c) => c.value)).toEqual(['—', '—', '—', '—', '—']);
    expect(chips.map((c) => c.label)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5']);
  });

  it('fills awarded points for completed slots', () => {
    const chips = buildLadderSlotBreakdown([
      makeSlotResult({ slotIndex: 1, awardedPoints: 7 }),
      makeSlotResult({ slotIndex: 3, awardedPoints: 12 }),
    ]);
    expect(chips[0]).toMatchObject({ slotIndex: 1, label: 'P1', value: '7' });
    expect(chips[1]).toMatchObject({ slotIndex: 2, value: '—' });
    expect(chips[2]).toMatchObject({ slotIndex: 3, value: '12' });
    expect(chips[3]).toMatchObject({ slotIndex: 4, value: '—' });
    expect(chips[4]).toMatchObject({ slotIndex: 5, value: '—' });
  });
});

describe('buildLadderSlotRows', () => {
  const hubSlots = [
    makeSlot({ id: 's1', slotIndex: 1, slotMaxPoints: 10 }),
    makeSlot({ id: 's2', slotIndex: 2, slotMaxPoints: 15 }),
    makeSlot({ id: 's3', slotIndex: 3, slotMaxPoints: 20 }),
    makeSlot({ id: 's4', slotIndex: 4, slotMaxPoints: 25 }),
    makeSlot({ id: 's5', slotIndex: 5, slotMaxPoints: 30 }),
  ];

  it('marks slot 1 active when attempt started on first slot', () => {
    const rows = buildLadderSlotRows({
      hubSlots,
      completedSlots: [],
      attemptStatus: 'started',
      nextSlotIndex: 1,
    });
    expect(rows).toHaveLength(5);
    expect(getLadderPuzzleCardState(rows[0])).toBe('active');
    expect(rows[0]).toMatchObject({
      rowVariant: 'active',
      statusSub: 'Available now',
      isAvailable: true,
      isLocked: false,
    });
    expect(getLadderPuzzleCardState(rows[1])).toBe('locked');
    expect(rows[1]).toMatchObject({
      rowVariant: 'muted',
      statusSub: 'Locked',
      unlockHint: 'Complete puzzle 1 to unlock',
      isLocked: true,
    });
    expect(getLadderPuzzleCardState(rows[2])).toBe('locked');
    expect(rows[2].unlockHint).toBe('Complete puzzle 2 to unlock');
  });

  it('marks slot 2 active when next slot is 2', () => {
    const rows = buildLadderSlotRows({
      hubSlots,
      completedSlots: [makeSlotResult({ slotIndex: 1, awardedPoints: 9 })],
      attemptStatus: 'started',
      nextSlotIndex: 2,
    });
    expect(getLadderPuzzleCardState(rows[0])).toBe('done');
    expect(rows[0]).toMatchObject({
      rowVariant: 'done',
      statusSub: 'Completed · 9 pts',
    });
    expect(getLadderPuzzleCardState(rows[1])).toBe('active');
    expect(getLadderPuzzleCardState(rows[2])).toBe('locked');
  });

  it('returns idle rows when run is completed with no per-slot results', () => {
    const rows = buildLadderSlotRows({
      hubSlots,
      completedSlots: [],
      attemptStatus: 'completed',
      nextSlotIndex: null,
    });
    expect(rows.every((row) => getLadderPuzzleCardState(row) === 'idle')).toBe(true);
    expect(rows.every((row) => row.statusSub === 'Up next')).toBe(true);
  });

  it('handles empty hub slots without throwing', () => {
    const rows = buildLadderSlotRows({
      hubSlots: [],
      completedSlots: [],
      attemptStatus: undefined,
      nextSlotIndex: 1,
    });
    expect(rows).toHaveLength(5);
    expect(rows[0].slot).toBeUndefined();
    expect(getLadderPuzzleCardState(rows[0])).toBe('active');
  });

  it('preserves slot ordering 1 through 5', () => {
    const rows = buildLadderSlotRows({
      hubSlots: [hubSlots[2], hubSlots[0], hubSlots[1]],
      completedSlots: [],
      attemptStatus: 'started',
      nextSlotIndex: 1,
    });
    expect(rows.map((r) => r.slotIndex)).toEqual([1, 2, 3, 4, 5]);
    expect(rows[0].step.title).toBe('Puzzle 1');
    expect(rows[4].step.title).toBe('Puzzle 5');
  });
});

describe('computeLadderTotalPoints', () => {
  it('sums slotMaxPoints across slots', () => {
    expect(
      computeLadderTotalPoints([
        makeSlot({ slotMaxPoints: 10 }),
        makeSlot({ slotMaxPoints: 15 }),
        makeSlot({ slotMaxPoints: 20 }),
        makeSlot({ slotMaxPoints: 25 }),
        makeSlot({ slotMaxPoints: 30 }),
      ]),
    ).toBe(100);
  });

  it('returns 0 for an empty slot list', () => {
    expect(computeLadderTotalPoints([])).toBe(0);
  });
});
