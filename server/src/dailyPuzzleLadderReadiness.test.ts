import { describe, expect, it } from 'vitest';
import {
  assessDailyPuzzleLadderReadiness,
  getPacificMinutesSinceMidnight,
  LADDER_READINESS_GRACE_MINUTES_PT,
} from './dailyPuzzleLadderReadiness';
import type { DailyPuzzleSlot } from './dailyPuzzle';

function slot(overrides: Partial<DailyPuzzleSlot>): DailyPuzzleSlot {
  return {
    id: `slot-${overrides.slotIndex ?? 1}`,
    puzzleDate: '2026-06-11',
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

describe('dailyPuzzleLadderReadiness', () => {
  it('marks a five-slot ladder ready', () => {
    const readiness = assessDailyPuzzleLadderReadiness('2026-06-11', [
      slot({ slotIndex: 1 }),
      slot({ slotIndex: 2, slotTitle: 'Read', tier: 'tactical_setup', slotMaxPoints: 350 }),
      slot({ slotIndex: 3, slotTitle: 'Master Chain', tier: 'master_chain', slotMaxPoints: 400 }),
      slot({ slotIndex: 4, slotTitle: 'Pressure', tier: 'master_chain', slotMaxPoints: 450 }),
      slot({ slotIndex: 5, slotTitle: 'Puzzle 5', tier: 'master_chain', slotMaxPoints: 500 }),
    ]);
    expect(readiness.ready).toBe(true);
    expect(readiness.shouldAlert).toBe(false);
    expect(readiness.missingSlotIndexes).toEqual([]);
  });

  it('marks a five-slot ladder ready', () => {
    const readiness = assessDailyPuzzleLadderReadiness('2026-06-11', [
      slot({ slotIndex: 1 }),
      slot({ slotIndex: 2, slotTitle: 'Tactical Setup', tier: 'tactical_setup', slotMaxPoints: 250 }),
      slot({ slotIndex: 3, slotTitle: 'Master Chain', tier: 'master_chain', slotMaxPoints: 400 }),
      slot({ slotIndex: 4, slotTitle: 'Puzzle 4', tier: 'master_chain', slotMaxPoints: 300 }),
      slot({ slotIndex: 5, slotTitle: 'Puzzle 5', tier: 'master_chain', slotMaxPoints: 300 }),
    ]);
    expect(readiness.ready).toBe(true);
    expect(readiness.shouldAlert).toBe(false);
    expect(readiness.missingSlotIndexes).toEqual([]);
  });

  it('flags partial publish as not ready and alerts after grace', () => {
    const readiness = assessDailyPuzzleLadderReadiness(
      '2026-06-11',
      [slot({ slotIndex: 1 }), slot({ slotIndex: 3, slotTitle: 'Master Chain', tier: 'master_chain', slotMaxPoints: 400 })],
      new Date('2026-06-11T08:30:00-07:00'),
    );
    expect(readiness.ready).toBe(false);
    expect(readiness.publishedSlotCount).toBe(2);
    expect(readiness.missingSlotIndexes).toEqual([2]);
    expect(readiness.shouldAlert).toBe(true);
    expect(readiness.alertReason).toContain('missing: 2');
  });

  it('does not alert before Pacific grace window ends', () => {
    const now = new Date('2026-06-11T00:05:00-07:00');
    expect(getPacificMinutesSinceMidnight(now)).toBe(5);
    const readiness = assessDailyPuzzleLadderReadiness('2026-06-11', [], now);
    expect(readiness.ready).toBe(false);
    expect(readiness.shouldAlert).toBe(false);
  });

  it('exposes a 15-minute Pacific grace constant', () => {
    expect(LADDER_READINESS_GRACE_MINUTES_PT).toBe(15);
  });
});
