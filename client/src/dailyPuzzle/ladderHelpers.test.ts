// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { formatDateLabel, getLadderPuzzleCardState } from './ladderHelpers';

describe('formatDateLabel', () => {
  it('formats a valid ISO date string', () => {
    const result = formatDateLabel('2024-01-15');
    expect(result).toContain('2024');
    expect(result).toContain('15');
  });

  it('returns the input when parsing fails', () => {
    expect(formatDateLabel('not-a-date')).toBe('not-a-date');
  });
});

describe('getLadderPuzzleCardState', () => {
  it('returns done when slotResult is present', () => {
    expect(getLadderPuzzleCardState({
      slotResult: { awardedPoints: 10 },
      isLocked: false,
      isAvailable: true,
    })).toBe('done');
  });

  it('returns locked when locked without a result', () => {
    expect(getLadderPuzzleCardState({
      slotResult: null,
      isLocked: true,
      isAvailable: false,
    })).toBe('locked');
  });

  it('returns active when available and not locked', () => {
    expect(getLadderPuzzleCardState({
      slotResult: null,
      isLocked: false,
      isAvailable: true,
    })).toBe('active');
  });

  it('returns idle otherwise', () => {
    expect(getLadderPuzzleCardState({
      slotResult: null,
      isLocked: false,
      isAvailable: false,
    })).toBe('idle');
  });
});