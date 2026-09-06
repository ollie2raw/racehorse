import { describe, expect, it } from 'vitest';
import {
  DAILY_PUZZLE_GENERATION_MIN_LOOKAHEAD_DAYS,
  addDaysToIsoDate,
  assessDailyPuzzleGenerationHealth,
  daysBetweenIsoDates,
} from './dailyPuzzleGenerationHealth';

describe('addDaysToIsoDate', () => {
  it('adds calendar days, crossing month and year boundaries', () => {
    expect(addDaysToIsoDate('2026-09-05', 30)).toBe('2026-10-05');
    expect(addDaysToIsoDate('2026-12-20', 30)).toBe('2027-01-19');
    expect(addDaysToIsoDate('2024-02-28', 1)).toBe('2024-02-29'); // leap year
  });
});

describe('daysBetweenIsoDates', () => {
  it('returns whole calendar days, signed', () => {
    expect(daysBetweenIsoDates('2026-09-05', '2026-10-05')).toBe(30);
    expect(daysBetweenIsoDates('2026-09-05', '2026-09-05')).toBe(0);
    expect(daysBetweenIsoDates('2026-09-05', '2026-09-01')).toBe(-4);
  });
});

describe('assessDailyPuzzleGenerationHealth', () => {
  const today = '2026-09-05';
  const N = DAILY_PUZZLE_GENERATION_MIN_LOOKAHEAD_DAYS; // 30
  const requiredThrough = addDaysToIsoDate(today, N); // 2026-10-05

  it('is ok when the furthest published date is far beyond the horizon (healthy cron)', () => {
    // gen-puzzles.yml seeds ~363 days out
    const snap = assessDailyPuzzleGenerationHealth(today, addDaysToIsoDate(today, 363));
    expect(snap.ok).toBe(true);
    expect(snap.shouldAlert).toBe(false);
    expect(snap.alertReason).toBeNull();
    expect(snap.lookaheadDays).toBe(363);
  });

  it('is ok exactly at the horizon boundary (furthest === today + N)', () => {
    const snap = assessDailyPuzzleGenerationHealth(today, requiredThrough);
    expect(snap.ok).toBe(true);
    expect(snap.shouldAlert).toBe(false);
    expect(snap.requiredThroughDate).toBe(requiredThrough);
  });

  it('trips one day inside the horizon (furthest === today + N - 1)', () => {
    const snap = assessDailyPuzzleGenerationHealth(today, addDaysToIsoDate(today, N - 1));
    expect(snap.ok).toBe(false);
    expect(snap.shouldAlert).toBe(true);
    expect(snap.alertReason).toContain('generation is behind');
    expect(snap.lookaheadDays).toBe(N - 1);
  });

  it('trips hard when the table has no published rows at all', () => {
    const snap = assessDailyPuzzleGenerationHealth(today, null);
    expect(snap.ok).toBe(false);
    expect(snap.shouldAlert).toBe(true);
    expect(snap.furthestPublishedDate).toBeNull();
    expect(snap.lookaheadDays).toBeNull();
    expect(snap.alertReason).toContain('(none)');
  });

  it('does not false-positive on a single missing near-term day (still 300d of runway)', () => {
    // One bad day in the near term is invisible to a horizon check as long as the
    // furthest date is still far out — which is the point of the repurpose.
    const snap = assessDailyPuzzleGenerationHealth(today, addDaysToIsoDate(today, 300));
    expect(snap.ok).toBe(true);
  });

  it('honours a custom minLookaheadDays', () => {
    expect(assessDailyPuzzleGenerationHealth(today, addDaysToIsoDate(today, 10), 7).ok).toBe(true);
    expect(assessDailyPuzzleGenerationHealth(today, addDaysToIsoDate(today, 10), 14).ok).toBe(false);
  });
});
