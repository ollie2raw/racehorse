import { describe, expect, it } from 'vitest';
import {
  findReadyDailyPuzzleLadderSlots,
  isDailyPuzzleLadderReady,
  type DailyPuzzleSlot,
} from './dailyPuzzle';
import { createHighScorePuzzle } from './generatePuzzles';
import {
  DAILY_PUZZLE_LADDER_PROFILES,
  choosePuzzleForSlot,
  type LadderSlotGenerationProfile,
} from './seedDailyPuzzleLadder';
// The retired ladder's slot-label presentation (client/src/dailyPuzzle/
// presentation.ts) and the ladder screens were deleted — CODE_QUALITY_PLAN.md
// §CQ9.1.6. Their tests went with them; the live generation + readiness cases
// below stay.

const tacticalProfile: LadderSlotGenerationProfile = {
  slotIndex: 2,
  tier: 'tactical_setup',
  slotTitle: 'Tactical Setup',
  slotMaxPoints: 250,
  targetHandSizeRange: [5, 6],
  targetBestScoreRange: [35, 75],
  preferredPuzzleTypes: ['setup_and_strike'],
};

describe('Daily Puzzle ladder generation budgets', () => {
  it('publishes a three-stage difficulty and 800-point scoring curve', () => {
    expect(DAILY_PUZZLE_LADDER_PROFILES).toHaveLength(3);
    expect(DAILY_PUZZLE_LADDER_PROFILES.map((profile) => profile.slotIndex)).toEqual([1, 2, 3]);
    expect(DAILY_PUZZLE_LADDER_PROFILES.map((profile) => profile.slotTitle)).toEqual([
      'Quick Hit',
      'Tactical Setup',
      'Master Chain',
    ]);
    expect(DAILY_PUZZLE_LADDER_PROFILES.map((profile) => profile.targetHandSizeRange)).toEqual([
      [3, 4],
      [5, 6],
      [8, 10],
    ]);
    expect(DAILY_PUZZLE_LADDER_PROFILES.map((profile) => profile.slotMaxPoints)).toEqual([
      150,
      250,
      400,
    ]);
    expect(DAILY_PUZZLE_LADDER_PROFILES.reduce((sum, profile) => sum + profile.slotMaxPoints, 0)).toBe(800);
    expect(DAILY_PUZZLE_LADDER_PROFILES[1].preferredPuzzleTypes).toEqual([
      'setup_and_strike',
      'one_turn_high_score',
    ]);
  });

  it('keeps the opener short and on the easier best-score band, not the pre-August floor', () => {
    const opener = DAILY_PUZZLE_LADDER_PROFILES[0];
    expect(opener.targetHandSizeRange).toEqual([3, 4]);
    expect(opener.targetBestScoreRange).toEqual([5, 25]);
  });

  it('turns repeated null Tactical Setup candidates into a structured failure', async () => {
    const result = await choosePuzzleForSlot('2026-05-17', tacticalProfile, {
      purpose: 'request',
      budget: {
        maxAttemptsPerSlot: 20,
        setupAndStrikeAttempts: 20,
        structuralFailureThreshold: 3,
        maxMsPerSlot: 10_000,
      },
      builders: {
        setupAndStrike: () => null,
      },
      now: () => 1_000,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('structural_failure');
    expect(result.attemptsTried).toBe(5);
    expect(result.topRejectionReasons).toContainEqual({ reason: 'null_candidate', count: 5 });
  });

  it('aborts on maxAttempts without throwing repeated validation exceptions', async () => {
    const result = await choosePuzzleForSlot('2026-05-17', tacticalProfile, {
      purpose: 'request',
      budget: {
        maxAttemptsPerSlot: 5,
        setupAndStrikeAttempts: 20,
        structuralFailureThreshold: 50,
        maxMsPerSlot: 10_000,
      },
      builders: {
        setupAndStrike: () => {
          throw new Error('Unable to find setup-and-strike sequence.');
        },
      },
      now: () => 1_000,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('attempt_limit');
    expect(result.attemptsTried).toBe(5);
    expect(result.topRejectionReasons).toContainEqual({ reason: 'no_solution', count: 5 });
  });

  it('aborts on maxMs', async () => {
    let nowCalls = 0;
    const result = await choosePuzzleForSlot('2026-05-17', tacticalProfile, {
      purpose: 'request',
      budget: {
        maxAttemptsPerSlot: 50,
        setupAndStrikeAttempts: 50,
        structuralFailureThreshold: 50,
        maxMsPerSlot: 2,
      },
      builders: {
        setupAndStrike: () => {
          throw new Error('Unable to find setup-and-strike sequence.');
        },
      },
      now: () => {
        nowCalls += 1;
        return 1_000 + nowCalls;
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('timeout');
    expect(result.attemptsTried).toBe(1);
    expect(result.topRejectionReasons.some((entry) => entry.reason === 'timeout')).toBe(true);
  });

  it('exhausts attempt budget on repeated missing tile builder failures instead of early abort', async () => {
    const result = await choosePuzzleForSlot('2026-05-17', tacticalProfile, {
      purpose: 'request',
      budget: {
        maxAttemptsPerSlot: 20,
        setupAndStrikeAttempts: 20,
        structuralFailureThreshold: 2,
        maxMsPerSlot: 10_000,
      },
      builders: {
        setupAndStrike: () => {
          throw new TypeError("Cannot read properties of null (reading 'tiles')");
        },
        oneTurnHighScore: () => {
          throw new TypeError("Cannot read properties of null (reading 'tiles')");
        },
      },
      now: () => 1_000,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('attempt_limit');
    expect(result.attemptsTried).toBe(20);
    expect(result.topRejectionReasons).toContainEqual({ reason: 'missing_tiles', count: 20 });
  });

  it('uses a reported fallback tier when primary Tactical Setup fails but fallback type succeeds', async () => {
    const result = await choosePuzzleForSlot('2026-05-17', {
      ...tacticalProfile,
      preferredPuzzleTypes: ['setup_and_strike', 'one_turn_high_score'],
    }, {
      purpose: 'manual',
      budget: {
        maxAttemptsPerSlot: 20,
        setupAndStrikeAttempts: 1,
        highScoreAttempts: 10,
        structuralFailureThreshold: 10,
        maxMsPerSlot: 10_000,
      },
      builders: {
        setupAndStrike: () => {
          throw new Error('Unable to find setup-and-strike sequence.');
        },
        oneTurnHighScore: createHighScorePuzzle,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.strategy).toBe('one_turn_high_score');
    expect(result.fallbackTier).toBe('fallback_type');
    expect(result.topRejectionReasons).toContainEqual({ reason: 'no_solution', count: 3 });
  }, 20_000);
});

function slot(overrides: Partial<DailyPuzzleSlot>): DailyPuzzleSlot {
  return {
    id: `slot-${overrides.slotIndex ?? 1}`,
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
    startingBoard: {},
    startingHand: [{ low: 1, high: 1 }],
    objectiveType: 'one_turn_high_score',
    objectivePayload: { best_possible_score: 25 },
    setVersion: 1,
    published: true,
    ...overrides,
  };
}

describe('Daily Puzzle ladder readiness and unavailable copy', () => {
  it('returns false when fewer than three slots exist', () => {
    expect(isDailyPuzzleLadderReady([slot({ slotIndex: 1 }), slot({ slotIndex: 2 })])).toBe(false);
  });

  it('returns true for a complete three-slot ladder', () => {
    expect(isDailyPuzzleLadderReady([
      slot({ slotIndex: 1, slotTitle: 'Quick Hit', tier: 'quick_line', slotMaxPoints: 150 }),
      slot({ slotIndex: 2, slotTitle: 'Tactical Setup', tier: 'tactical_setup', slotMaxPoints: 250 }),
      slot({ slotIndex: 3, slotTitle: 'Master Chain', tier: 'master_chain', slotMaxPoints: 400 }),
    ])).toBe(true);
  });

  it('still serves a day that was published at the old five-slot length', () => {
    // Transition day: slots 4-5 remain in the table. The ladder is the first
    // three, not "unready forever".
    const ladder = findReadyDailyPuzzleLadderSlots([
      slot({ slotIndex: 1, slotTitle: 'Quick Hit', tier: 'quick_line', slotMaxPoints: 100 }),
      slot({ slotIndex: 2, slotTitle: 'Build', tier: 'quick_line', slotMaxPoints: 150 }),
      slot({ slotIndex: 3, slotTitle: 'Read', tier: 'tactical_setup', slotMaxPoints: 200 }),
      slot({ slotIndex: 4, slotTitle: 'Pressure', tier: 'tactical_setup', slotMaxPoints: 250 }),
      slot({ slotIndex: 5, slotTitle: 'Master Chain', tier: 'master_chain', slotMaxPoints: 300 }),
    ]);
    expect(ladder?.map((entry) => entry.slotIndex)).toEqual([1, 2, 3]);
  });

  it('returns false when scoring metadata is missing', () => {
    expect(isDailyPuzzleLadderReady([
      slot({ slotIndex: 1, slotTitle: 'Quick Hit', tier: 'quick_line' }),
      slot({
        slotIndex: 2,
        slotTitle: 'Tactical Setup',
        tier: 'tactical_setup',
        slotMaxPoints: 250,
        bestPossibleScore: null,
      }),
      slot({ slotIndex: 3, slotTitle: 'Master Chain', tier: 'master_chain', slotMaxPoints: 400 }),
    ])).toBe(false);
  });

  // (The request-time ladder-generation opt-out — isRequestPuzzleGenerationEnabled
  // + listDailyPuzzleSlotsForDateWithAutoSeed — was removed with the retired
  // ladder's attempt-tracking surface, §CQ9.1.6.4. The generator itself
  // (createHighScorePuzzle / choosePuzzleForSlot, tested above) stays.)
});
