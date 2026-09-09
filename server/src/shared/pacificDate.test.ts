import { describe, expect, it } from 'vitest';
import { shiftDateKey } from './pacificDate';

describe('shiftDateKey', () => {
  it('adds and subtracts whole days', () => {
    expect(shiftDateKey('2026-09-09', 1)).toBe('2026-09-10');
    expect(shiftDateKey('2026-09-09', -1)).toBe('2026-09-08');
    expect(shiftDateKey('2026-09-09', 0)).toBe('2026-09-09');
    expect(shiftDateKey('2026-09-09', 7)).toBe('2026-09-16');
  });

  it('rolls over month boundaries in both directions', () => {
    expect(shiftDateKey('2026-09-30', 1)).toBe('2026-10-01');
    expect(shiftDateKey('2026-10-01', -1)).toBe('2026-09-30');
    expect(shiftDateKey('2026-08-31', 1)).toBe('2026-09-01');
  });

  it('rolls over year boundaries', () => {
    expect(shiftDateKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDateKey('2027-01-01', -1)).toBe('2026-12-31');
    expect(shiftDateKey('2026-12-20', 30)).toBe('2027-01-19');
  });

  it('handles leap years', () => {
    expect(shiftDateKey('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftDateKey('2024-02-29', 1)).toBe('2024-03-01');
    expect(shiftDateKey('2026-02-28', 1)).toBe('2026-03-01'); // 2026 is not a leap year
  });

  it('is timezone-independent — no DST spring-forward/fall-back drift', () => {
    // US DST transitions (2nd Sun Mar, 1st Sun Nov) — a naive local-time impl
    // would drop or double a day here.
    expect(shiftDateKey('2026-03-07', 2)).toBe('2026-03-09');
    expect(shiftDateKey('2026-11-01', 2)).toBe('2026-11-03');
  });
});
