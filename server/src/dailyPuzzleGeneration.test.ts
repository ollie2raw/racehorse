import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
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
import {
  getDailyPuzzleDisplayTitle,
  getDailyPuzzleStepPresentation,
} from '../../client/src/dailyPuzzle/presentation';

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

  it('keeps unavailable copy product-facing', () => {
    const source = readFileSync(
      resolve(__dirname, '../../client/src/dailyPuzzle/DailyPuzzleScreen.tsx'),
      'utf8',
    );
    expect(source).toContain('Today’s Puzzle Ladder is being prepared');
    expect(source).not.toContain('valid scoring metadata');
    expect(source).not.toContain('single-puzzle format is no longer offered');
  });

  it('maps ladder slot indexes to clean user-facing puzzle labels', () => {
    expect(getDailyPuzzleStepPresentation(1)).toEqual({
      title: 'Quick Hit',
      subtitle: 'Warm-up',
      shortLabel: 'P1',
    });
    expect(getDailyPuzzleStepPresentation(2)).toEqual({
      title: 'Tactical Setup',
      subtitle: 'Tactical test',
      shortLabel: 'P2',
    });
    expect(getDailyPuzzleStepPresentation(3)).toEqual({
      title: 'Master Chain',
      subtitle: 'Finale',
      shortLabel: 'P3',
    });
  });

  it('renders stored off-ladder slot titles with clean puzzle labels', () => {
    // Titles from earlier ladder shapes (e.g. the five-slot 'Build'/'Read'
    // rungs) are not current step identities, so they fall back to Puzzle N.
    expect(getDailyPuzzleDisplayTitle(1, 'Quick Line')).toBe('Puzzle 1');
    expect(getDailyPuzzleDisplayTitle(2, 'Build')).toBe('Puzzle 2');
    expect(getDailyPuzzleDisplayTitle(3, 'Read')).toBe('Puzzle 3');
    expect(getDailyPuzzleDisplayTitle(2, 'Build')).not.toBe('Build');
  });

  it('renders the published three-stage identities', () => {
    expect(getDailyPuzzleDisplayTitle(1, 'Quick Hit')).toBe('Quick Hit');
    expect(getDailyPuzzleDisplayTitle(2, 'Tactical Setup')).toBe('Tactical Setup');
    expect(getDailyPuzzleDisplayTitle(3, 'Master Chain')).toBe('Master Chain');
  });

  it('still labels archived five-slot rungs', () => {
    expect(getDailyPuzzleDisplayTitle(4, 'Pressure')).toBe('Pressure');
    expect(getDailyPuzzleDisplayTitle(5, 'Master Chain')).toBe('Master Chain');
  });

  it('allows fallback-published slots to keep clean product labels', () => {
    const legacyFallbackSlot = slot({
      slotIndex: 2,
      slotTitle: 'Read',
      puzzleType: 'one_turn_high_score',
      objectiveType: 'one_turn_high_score',
    });
    expect(getDailyPuzzleDisplayTitle(legacyFallbackSlot.slotIndex, legacyFallbackSlot.slotTitle)).toBe('Puzzle 2');
  });

  it('keeps request-time generation opt-out via ENABLE_REQUEST_PUZZLE_GENERATION=false', () => {
    const source = readFileSync(resolve(__dirname, 'http/stores/dailyPuzzleStore.ts'), 'utf8');
    expect(source).toContain('isRequestPuzzleGenerationEnabled');
    expect(source).toContain('ENABLE_REQUEST_PUZZLE_GENERATION');
    expect(source).toContain('request-time generation skipped');
  });
});
