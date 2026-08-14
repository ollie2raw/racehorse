// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { createPuzzleMatchState } from './validator';
import type { CuratedDailyPuzzle } from './types';
import {
  loadDailyPuzzleLadderSession,
  persistDailyPuzzleLadderSession,
  type DailyPuzzleLadderSessionSnapshot,
} from './dailyPuzzleLadderSessionStorage';

const puzzle: CuratedDailyPuzzle = {
  id: 'puzzle-1',
  puzzleDate: '2026-07-22',
  title: 'Quick Line',
  startingBoard: {
    mainLine: [{ tile: { low: 3, high: 3 }, orientation: 'horizontal-normal' }],
    hubDoubles: [],
    leftEnd: 3,
    rightEnd: 3,
    leftEndIsDouble: true,
    rightEndIsDouble: true,
  },
  startingHand: [{ low: 0, high: 3 }],
  maxMoves: 1,
  targetScore: 1,
  puzzleType: 'reach_target',
  dealSize: 1,
};

function snapshot(): DailyPuzzleLadderSessionSnapshot {
  return {
    version: 1,
    attemptId: 'attempt-1',
    runDate: puzzle.puzzleDate,
    slotId: puzzle.id,
    slotIndex: 1,
    runtimeState: createPuzzleMatchState(puzzle),
    status: 'IN_PROGRESS',
    movesUsed: 3,
    finalScore: null,
    runningScore: 4,
    moveTrace: [{ move: 1 }],
    startedAt: 100,
    updatedAt: 200,
  };
}

describe('Daily Puzzle Ladder session storage', () => {
  beforeEach(() => window.localStorage.clear());

  it('restores an in-progress scored slot from durable storage', () => {
    const value = snapshot();
    persistDailyPuzzleLadderSession(value);
    expect(loadDailyPuzzleLadderSession('attempt-1', puzzle.puzzleDate, puzzle.id)).toEqual(value);
  });

  it('does not restore a checkpoint for another attempt or slot', () => {
    persistDailyPuzzleLadderSession(snapshot());
    expect(loadDailyPuzzleLadderSession('attempt-2', puzzle.puzzleDate, puzzle.id)).toBeNull();
    expect(loadDailyPuzzleLadderSession('attempt-1', puzzle.puzzleDate, 'puzzle-2')).toBeNull();
  });
});
