import { describe, it, expect } from 'vitest';
import {
  formatDateLabel,
  titleCaseTier,
  tierDisplayLabel,
  getDailyFritzGameSeed,
  normalizeGameNumber,
  formatMargin,
  formatCountdownHms,
  secondsUntilNextPacificMidnight,
  friendlyDailyFritzInitError,
  normalizeSetResult,
  getNextGameNumberFromSetResult,
} from './dailyFritzScreenHelpers';

describe('formatDateLabel', () => {
  it('formats a valid date string', () => {
    const result = formatDateLabel('2024-01-15');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
  it('handles invalid date gracefully', () => {
    expect(() => formatDateLabel('not-a-date')).not.toThrow();
  });
});

describe('titleCaseTier', () => {
  it('capitalizes first letter', () => {
    expect(titleCaseTier('amateur')).toBe('Amateur');
  });
  it('handles already-capitalized input', () => {
    expect(titleCaseTier('Pro')).toBe('Pro');
  });
  it('handles empty string', () => {
    expect(() => titleCaseTier('')).not.toThrow();
  });
});

describe('tierDisplayLabel', () => {
  it('returns a non-empty string for known tiers', () => {
    expect(tierDisplayLabel('pro').length).toBeGreaterThan(0);
    expect(tierDisplayLabel('amateur').length).toBeGreaterThan(0);
  });
});

describe('getDailyFritzGameSeed', () => {
  it('returns a string seed', () => {
    expect(typeof getDailyFritzGameSeed('2024-01-15', 1)).toBe('string');
  });
  it('returns different seeds for different dates', () => {
    const a = getDailyFritzGameSeed('2024-01-15', 1);
    const b = getDailyFritzGameSeed('2024-01-16', 1);
    expect(a).not.toBe(b);
  });
  it('returns different seeds for different game numbers', () => {
    const a = getDailyFritzGameSeed('2024-01-15', 1);
    const b = getDailyFritzGameSeed('2024-01-15', 2);
    expect(a).not.toBe(b);
  });
});

describe('normalizeGameNumber', () => {
  it('returns 1 for valid game number 1', () => {
    expect(normalizeGameNumber(1)).toBe(1);
  });
  it('returns fallback for null', () => {
    expect(normalizeGameNumber(null, 1)).toBe(1);
  });
  it('returns fallback for out-of-range value', () => {
    expect(normalizeGameNumber(99, 1)).toBe(1);
  });
});

describe('formatMargin', () => {
  it('formats positive margin', () => {
    expect(formatMargin(10)).toMatch(/\+?10|10/);
  });
  it('formats negative margin', () => {
    expect(formatMargin(-5)).toMatch(/-5/);
  });
  it('formats zero', () => {
    expect(typeof formatMargin(0)).toBe('string');
  });
});

describe('formatCountdownHms', () => {
  it('formats zero seconds', () => {
    expect(formatCountdownHms(0)).toMatch(/0/);
  });
  it('formats one hour', () => {
    expect(formatCountdownHms(3600)).toMatch(/1/);
  });
  it('formats 90 minutes', () => {
    const result = formatCountdownHms(5400);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('secondsUntilNextPacificMidnight', () => {
  it('returns a positive number', () => {
    expect(secondsUntilNextPacificMidnight(new Date())).toBeGreaterThan(0);
  });
  it('returns less than 86400 seconds', () => {
    expect(secondsUntilNextPacificMidnight(new Date())).toBeLessThanOrEqual(86400);
  });
});

describe('friendlyDailyFritzInitError', () => {
  it('returns string for Error object', () => {
    expect(typeof friendlyDailyFritzInitError(new Error('fail'))).toBe('string');
  });
  it('returns string for unknown input', () => {
    expect(typeof friendlyDailyFritzInitError('raw string')).toBe('string');
    expect(typeof friendlyDailyFritzInitError(null)).toBe('string');
  });
});

describe('normalizeSetResult', () => {
  it('returns null for null input', () => {
    expect(normalizeSetResult(null)).toBeNull();
  });
  it('returns null for invalid input', () => {
    expect(normalizeSetResult('garbage')).toBeNull();
  });
});

describe('getNextGameNumberFromSetResult', () => {
  it('returns 1 when set result is null', () => {
    expect(getNextGameNumberFromSetResult(null)).toBe(1);
  });
});
