import { describe, expect, it } from 'vitest';
import { buildPuzzleStatsSummary, type PuzzleDayResult } from './puzzleStatsSummary';

const day = (date: string, score: number | null = null): PuzzleDayResult => ({ date, score });

describe('buildPuzzleStatsSummary', () => {
  it('unions Rush and frozen Ladder days across the mode boundary without a gap', () => {
    // Ladder history runs up to the day Rush shipped; Rush continues it.
    const summary = buildPuzzleStatsSummary({
      todayDateKey: '2026-08-22',
      legacyDays: [day('2026-08-18'), day('2026-08-19'), day('2026-08-20')],
      rushDays: [day('2026-08-21'), day('2026-08-22')],
    });
    expect(summary.completions).toBe(5);
    expect(summary.currentStreak).toBe(5);
    expect(summary.bestStreak).toBe(5);
  });

  it('anchors the current streak on yesterday when today is not yet done', () => {
    const summary = buildPuzzleStatsSummary({
      todayDateKey: '2026-09-08',
      legacyDays: [],
      rushDays: [day('2026-09-06'), day('2026-09-07')],
    });
    expect(summary.currentStreak).toBe(2);
  });

  it('breaks the current streak on a gap but keeps the best run', () => {
    const summary = buildPuzzleStatsSummary({
      todayDateKey: '2026-09-08',
      legacyDays: [day('2026-09-01'), day('2026-09-02'), day('2026-09-03')],
      rushDays: [day('2026-09-08')],
    });
    expect(summary.currentStreak).toBe(1);
    expect(summary.bestStreak).toBe(3);
  });

  it('counts distinct completed days in the trailing 7-day window', () => {
    const summary = buildPuzzleStatsSummary({
      todayDateKey: '2026-09-08',
      legacyDays: [day('2026-08-30')], // outside the window
      rushDays: [day('2026-09-02'), day('2026-09-02'), day('2026-09-08')],
    });
    expect(summary.completionsThisWeek).toBe(2);
  });

  it('takes the best score across both eras and today-only from Rush', () => {
    const summary = buildPuzzleStatsSummary({
      todayDateKey: '2026-09-08',
      legacyDays: [day('2026-07-27', 800)],
      rushDays: [day('2026-08-31', 2163), day('2026-09-08', 1907), day('2026-09-08', 2050)],
    });
    expect(summary.bestScoreEver).toBe(2163);
    expect(summary.bestScoreToday).toBe(2050);
  });

  it('returns zeros / nulls for a user with no puzzle history', () => {
    const summary = buildPuzzleStatsSummary({ todayDateKey: '2026-09-08', legacyDays: [], rushDays: [] });
    expect(summary).toEqual({
      completions: 0,
      currentStreak: 0,
      bestStreak: 0,
      completionsThisWeek: 0,
      bestScoreToday: null,
      bestScoreEver: null,
    });
  });
});
