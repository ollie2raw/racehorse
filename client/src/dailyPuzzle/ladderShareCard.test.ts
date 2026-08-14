// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildLadderShareText, type DailyPuzzleLadderShareData } from './ladderShareCard';

const sample: DailyPuzzleLadderShareData = {
  shareDate: 'July 23, 2026',
  totalScore: 240,
  rank: 4,
  slotLines: ['Setup 80', 'Strike 90', 'Master 70'],
  shareStreak: 3,
  shareRating: 1520,
};

describe('buildLadderShareText', () => {
  it('produces premium plain text without emoji', () => {
    const text = buildLadderShareText(sample);
    expect(text).toContain('Daily Puzzle Ladder · July 23, 2026');
    expect(text).toContain('240 PTS · Rank #4');
    expect(text).toContain('3-day streak');
    expect(text).not.toMatch(/[🧩🔥✓]/u);
  });
});
