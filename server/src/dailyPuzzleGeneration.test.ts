import { describe, expect, it } from 'vitest';
import {
  choosePuzzleForSlot,
  type LadderSlotGenerationProfile,
} from './seedDailyPuzzleLadder';

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
    expect(result.attemptsTried).toBe(3);
    expect(result.topRejectionReasons).toContainEqual({ reason: 'null_candidate', count: 3 });
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

  it('classifies null branch tile errors as structural missing tile failures', async () => {
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
      },
      now: () => 1_000,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('structural_failure');
    expect(result.attemptsTried).toBe(2);
    expect(result.topRejectionReasons).toContainEqual({ reason: 'missing_tiles', count: 2 });
  });
});
