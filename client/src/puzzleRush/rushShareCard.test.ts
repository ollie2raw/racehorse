import { describe, it, expect } from 'vitest';
import { buildRushShareText } from './rushShareCard';
import { SITE_DOMAIN } from '../lib/siteUrl';

describe('buildRushShareText', () => {
  it('shows puzzle number, one emoji per puzzle, solve count, and time', () => {
    const text = buildRushShareText({
      score: 250,
      solved: 2,
      puzzles: [
        { solved: true },
        { solved: false },
        { solved: true },
      ],
      secondsBanked: 2,
      runDate: '2026-08-31',
    });
    expect(text).toContain('Racehorse Puzzle Rush #144');
    expect(text).toContain('🟩🟥🟩');
    expect(text).toContain('2 solved');
    expect(text).toContain('2s');
    expect(text).toContain(SITE_DOMAIN);
  });

  it('formats minutes and seconds correctly', () => {
    const text = buildRushShareText({
      score: 900,
      solved: 7,
      puzzles: [
        { solved: true },
        { solved: true },
        { solved: true },
        { solved: true },
        { solved: true },
        { solved: true },
        { solved: true },
      ],
      secondsBanked: 125, // 2m 5s
      runDate: '2026-08-31',
    });
    expect(text).toContain('2m 5s');
  });

  it('omits time when no bonuses earned', () => {
    const text = buildRushShareText({
      score: 250,
      solved: 2,
      puzzles: [
        { solved: true },
        { solved: false },
      ],
      secondsBanked: 0,
      runDate: '2026-08-31',
    });
    // Should only show solve count, no time bonuses
    const lines = text.split('\n');
    expect(lines[2]).toBe('2 solved');
    expect(text).not.toMatch(/\d+[ms]\s/); // No "5s " or "2m " pattern
  });

  it('calculates puzzle number from run_date', () => {
    const text = buildRushShareText({
      score: 10,
      solved: 1,
      puzzles: [{ solved: true }],
      secondsBanked: 0,
      runDate: '2026-04-10',
    });
    expect(text).toContain('#1');
  });

  it('defaults to puzzle #1 when run_date is missing', () => {
    const text = buildRushShareText({
      score: 10,
      solved: 1,
      puzzles: [{ solved: true }],
      secondsBanked: 0,
    });
    expect(text).toContain('#1');
  });

  it('handles max-length run (15 puzzles) without truncation', () => {
    const puzzles = Array(15).fill(null).map((_, i) => ({ solved: i < 13 }));
    const text = buildRushShareText({
      score: 1200,
      solved: 13,
      puzzles,
      secondsBanked: 45,
      runDate: '2026-08-31',
    });
    const emojiLine = text.split('\n')[1];
    const greenCount = (emojiLine.match(/🟩/g) ?? []).length;
    const redCount = (emojiLine.match(/🟥/g) ?? []).length;
    expect(greenCount).toBe(13);
    expect(redCount).toBe(2);
    expect(text).toContain('13 solved');
  });
});
