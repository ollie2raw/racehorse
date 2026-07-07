import { describe, expect, it } from 'vitest';
import {
  resolveLegacyBestPossibleScore,
  resolveLegacyFinalizeSolvedMoves,
  shouldAllowLegacyBackendSubmission,
} from './dailyPuzzleLegacyResultSubmission';

describe('shouldAllowLegacyBackendSubmission', () => {
  it('allows submission for signed-in daily (non-archive) first submit', () => {
    expect(
      shouldAllowLegacyBackendSubmission({
        isArchiveMode: false,
        userId: 'user-1',
        alreadySubmitted: false,
      }),
    ).toBe(true);
  });

  it('blocks archive mode', () => {
    expect(
      shouldAllowLegacyBackendSubmission({
        isArchiveMode: true,
        userId: 'user-1',
        alreadySubmitted: false,
      }),
    ).toBe(false);
  });

  it('blocks duplicate submission', () => {
    expect(
      shouldAllowLegacyBackendSubmission({
        isArchiveMode: false,
        userId: 'user-1',
        alreadySubmitted: true,
      }),
    ).toBe(false);
  });

  it('blocks guest users', () => {
    expect(
      shouldAllowLegacyBackendSubmission({
        isArchiveMode: false,
        userId: null,
        alreadySubmitted: false,
      }),
    ).toBe(false);
  });
});

describe('resolveLegacyFinalizeSolvedMoves', () => {
  it('passes nextMoves only for SOLVED (FAILED must be null for legacy finalize)', () => {
    expect(resolveLegacyFinalizeSolvedMoves('SOLVED', 3)).toBe(3);
    expect(resolveLegacyFinalizeSolvedMoves('FAILED', 3)).toBeNull();
  });
});

describe('resolveLegacyBestPossibleScore', () => {
  it('prefers cached score when positive', () => {
    expect(resolveLegacyBestPossibleScore(42, 99)).toBe(42);
  });

  it('falls back to worker score when cache is zero', () => {
    expect(resolveLegacyBestPossibleScore(0, 99)).toBe(99);
  });
});