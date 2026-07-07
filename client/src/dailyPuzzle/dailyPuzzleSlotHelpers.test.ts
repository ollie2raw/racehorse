import { describe, expect, it } from 'vitest';
import type { DailyPuzzleSlot } from './types';
import { toCuratedPuzzle } from './dailyPuzzleSlotHelpers';

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

describe('toCuratedPuzzle', () => {
  it('returns null when starting board or hand is missing', () => {
    expect(toCuratedPuzzle(makeSlot({ startingBoard: undefined }))).toBeNull();
    expect(toCuratedPuzzle(makeSlot({ startingHand: undefined }))).toBeNull();
  });

  it('maps a ladder slot into a curated daily puzzle', () => {
    const result = toCuratedPuzzle(makeSlot({ slotIndex: 2, slotTitle: 'Tactical Setup' }));
    expect(result).toMatchObject({
      id: 'slot-1',
      puzzleDate: '2024-06-01',
      slotIndex: 2,
      slotTitle: 'Tactical Setup',
      setVersion: 1,
      published: true,
      maxMoves: 3,
      targetScore: 30,
    });
    expect(result?.title).toBeTruthy();
    expect(result?.startingHand).toEqual([{ low: 1, high: 2 }]);
  });
});