import { describe, it, expect } from 'vitest';
import {
  puzzleInstanceKey,
  puzzleCacheKey,
  progressKey,
  tileKey,
  getDisplayName,
  formatPuzzleDateLabel,
  formatPuzzleElapsed,
  formatPuzzleLeaderboardDate,
} from './dailyPuzzleScreenHelpers';

describe('puzzleInstanceKey', () => {
  it('returns a string', () => {
    expect(typeof puzzleInstanceKey('2024-01-15', 'one_turn_high_score')).toBe('string');
  });
  it('differs by date', () => {
    expect(puzzleInstanceKey('2024-01-15', 'one_turn_high_score')).not.toBe(puzzleInstanceKey('2024-01-16', 'one_turn_high_score'));
  });
  it('differs by puzzleType', () => {
    expect(puzzleInstanceKey('2024-01-15', 'one_turn_high_score')).not.toBe(puzzleInstanceKey('2024-01-15', 'reach_target'));
  });
});

describe('puzzleCacheKey', () => {
  it('returns a string', () => {
    expect(typeof puzzleCacheKey('2024-01-15', 'one_turn_high_score')).toBe('string');
  });
  it('differs from puzzleInstanceKey', () => {
    expect(puzzleCacheKey('2024-01-15', 'one_turn_high_score')).not.toBe(puzzleInstanceKey('2024-01-15', 'one_turn_high_score'));
  });
});

describe('progressKey', () => {
  it('returns a string', () => {
    expect(typeof progressKey('2024-01-15', 'one_turn_high_score')).toBe('string');
  });
});

describe('tileKey', () => {
  it('returns consistent key for a tile', () => {
    expect(tileKey({ low: 3, high: 5 })).toBe(tileKey({ low: 3, high: 5 }));
  });
  it('returns different keys for different tiles', () => {
    expect(tileKey({ low: 3, high: 5 })).not.toBe(tileKey({ low: 2, high: 5 }));
  });
});

describe('getDisplayName', () => {
  it('returns username when provided', () => {
    expect(getDisplayName('alice')).toBe('alice');
  });
  it('returns fallback for null', () => {
    expect(typeof getDisplayName(null)).toBe('string');
  });
  it('returns fallback for undefined', () => {
    expect(typeof getDisplayName(undefined)).toBe('string');
  });
});

describe('formatPuzzleDateLabel', () => {
  it('returns a non-empty string', () => {
    expect(formatPuzzleDateLabel('2024-01-15').length).toBeGreaterThan(0);
  });
});

describe('formatPuzzleElapsed', () => {
  it('formats 0 seconds', () => {
    expect(typeof formatPuzzleElapsed(0)).toBe('string');
  });
  it('formats 65 seconds', () => {
    expect(formatPuzzleElapsed(65)).toMatch(/1/);
  });
  it('formats 3600 seconds', () => {
    expect(typeof formatPuzzleElapsed(3600)).toBe('string');
  });
});

describe('formatPuzzleLeaderboardDate', () => {
  it('returns a non-empty string', () => {
    expect(formatPuzzleLeaderboardDate('2024-01-15').length).toBeGreaterThan(0);
  });
});
