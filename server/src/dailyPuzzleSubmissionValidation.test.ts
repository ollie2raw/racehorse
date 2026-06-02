import { describe, expect, it } from 'vitest';
import { validateDailyPuzzleSubmission } from './dailyPuzzleSubmissionValidation';
import type { BoardState } from './game/types';
import type { DailyPuzzleSlot } from './dailyPuzzle';

const startingBoard: BoardState = {
  mainLine: [
    {
      tile: { low: 5, high: 5 },
      orientation: 'vertical-normal',
    },
  ],
  leftEnd: 5,
  rightEnd: 5,
  leftEndIsDouble: true,
  rightEndIsDouble: true,
  hubDoubles: [
    {
      hubId: 0,
      laneType: 'mainline',
      laneRef: 'mainline',
      tileIndex: 0,
      mainlineIndex: 0,
      hubValue: 5,
      isCrossed: false,
      leftSideFilled: false,
      rightSideFilled: false,
      branches: [],
    },
  ],
};

function slot(overrides: Partial<DailyPuzzleSlot> = {}): DailyPuzzleSlot {
  return {
    id: 'puzzle-1',
    puzzleDate: '2026-05-17',
    slotIndex: 1,
    slotTitle: 'Quick Line',
    tier: 'quick_line',
    puzzleType: 'one_turn_high_score',
    maxMoves: 1,
    targetScore: 2,
    dealSize: 14,
    slotMaxPoints: 150,
    bestPossibleScore: 2,
    startingBoard,
    startingHand: [
      { low: 0, high: 5 },
      { low: 1, high: 1 },
    ],
    objectiveType: 'one_turn_high_score',
    objectivePayload: { best_possible_score: 2 },
    setVersion: 1,
    published: true,
    ...overrides,
  };
}

describe('Daily Puzzle server submission validation', () => {
  it('ignores fake high rawScore and recomputes the legal line score', () => {
    const result = validateDailyPuzzleSubmission({
      slot: slot(),
      clientRawScore: 999,
      elapsedSeconds: 8,
      submittedLine: [{ tile: { low: 0, high: 5 }, position: 'right' }],
    });

    expect(result.rawScore).toBe(2);
    expect(result.movesUsed).toBe(1);
    expect(result.solved).toBe(true);
    expect(result.perfect).toBe(true);
    expect(result.result).toMatchObject({
      serverValidated: true,
      serverRawScore: 2,
      clientRawScore: 999,
    });
  });

  it('rejects a submitted tile that is not in the starting hand', () => {
    expect(() =>
      validateDailyPuzzleSubmission({
        slot: slot(),
        elapsedSeconds: 8,
        submittedLine: [{ tile: { low: 6, high: 6 }, position: 'right' }],
      }),
    ).toThrow(/not available in the starting hand/);
  });

  it('rejects duplicate use of the same starting-hand tile', () => {
    expect(() =>
      validateDailyPuzzleSubmission({
        slot: slot(),
        elapsedSeconds: 8,
        submittedLine: [
          { tile: { low: 0, high: 5 }, position: 'right' },
          { tile: { low: 0, high: 5 }, position: 'left' },
        ],
      }),
    ).toThrow(/not available in the starting hand/);
  });

  it('rejects legal-looking hand tiles when the placement is illegal', () => {
    expect(() =>
      validateDailyPuzzleSubmission({
        slot: slot(),
        elapsedSeconds: 8,
        submittedLine: [{ tile: { low: 1, high: 1 }, position: 'right' }],
      }),
    ).toThrow(/illegal/);
  });

  it('bounds elapsedSeconds without using it for score authority', () => {
    const result = validateDailyPuzzleSubmission({
      slot: slot(),
      elapsedSeconds: 999_999,
      submittedLine: [{ tile: { low: 0, high: 5 }, position: 'right' }],
    });

    expect(result.elapsedSeconds).toBe(86_400);
    expect(result.rawScore).toBe(2);
  });
});
