import { describe, expect, it, vi } from 'vitest';
import type { BoardState } from '@racehorse/game-core';
import type { DailyPuzzleSlot, DailyPuzzleSlotIndex } from '../dailyPuzzle';
import {
  buildDailyPuzzleFirstLegalLine,
  driveDailyPuzzleFiveSlotAttempt,
} from './dailyPuzzleLifecycleDriver';

const board: BoardState = {
  mainLine: [{ tile: { low: 5, high: 5 }, orientation: 'vertical-normal' }],
  leftEnd: 5,
  rightEnd: 5,
  leftEndIsDouble: true,
  rightEndIsDouble: true,
  hubDoubles: [{
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
  }],
};

function slot(slotIndex: DailyPuzzleSlotIndex): DailyPuzzleSlot {
  return {
    id: `puzzle-${slotIndex}`,
    puzzleDate: '2026-08-08',
    slotIndex,
    slotTitle: `Puzzle ${slotIndex}`,
    tier: 'master_chain',
    puzzleType: 'one_turn_high_score',
    maxMoves: 1,
    targetScore: 2,
    dealSize: 14,
    slotMaxPoints: 300,
    bestPossibleScore: 2,
    startingBoard: board,
    startingHand: [{ low: 0, high: 5 }],
    objectiveType: 'one_turn_high_score',
    objectivePayload: { best_possible_score: 2 },
    setVersion: 1,
    published: true,
  };
}

describe('Daily Puzzle lifecycle driver', () => {
  it('builds a move through shared game-core legal move generation', () => {
    expect(buildDailyPuzzleFirstLegalLine(slot(1))).toEqual([
      { tile: { low: 0, high: 5 }, position: 'left' },
    ]);
  });

  it('submits and replays all five slots before completing', async () => {
    const seen = new Set<number>();
    const request = vi.fn(async ({ path, body }: { path: string; body: Record<string, unknown> }) => {
      if (path.endsWith('/complete')) return { ok: true, attempt: { status: 'completed' } };
      const index = Number(body.slotIndex);
      if (seen.has(index)) return { ok: true, replayed: true };
      seen.add(index);
      return { ok: true, replayed: false };
    });

    const result = await driveDailyPuzzleFiveSlotAttempt({
      attemptId: 'attempt-1',
      puzzleDate: '2026-08-08',
      slots: [slot(5), slot(2), slot(1), slot(4), slot(3)],
      request,
    });

    expect(result).toMatchObject({ ok: true, attempt: { status: 'completed' } });
    expect(seen).toEqual(new Set([1, 2, 3, 4, 5]));
    expect(request).toHaveBeenCalledTimes(11);
  });

  it('rejects a five-item fixture that duplicates one slot and omits another', async () => {
    await expect(driveDailyPuzzleFiveSlotAttempt({
      attemptId: 'attempt-1',
      puzzleDate: '2026-08-08',
      slots: [slot(1), slot(2), slot(3), slot(4), slot(4)],
      request: vi.fn(),
    })).rejects.toThrow(/one Daily Puzzle slot for each index 1–5/);
  });
});
