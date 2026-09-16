import { describe, expect, it } from 'vitest';
import type { MoveRating } from './moveAnalyzer';
import { moveRatingCoachingCopy } from './moveRatingCoachingCopy';

const LEGACY_RATINGS: MoveRating[] = ['Brilliant', 'Great', 'Good', 'Inaccuracy', 'Mistake', 'Blunder'];
const HEURISTIC_RATINGS: Array<'Good' | 'Inaccuracy' | 'Blunder'> = ['Good', 'Inaccuracy', 'Blunder'];

describe('moveRatingCoachingCopy', () => {
  describe('precise tier (exact/search) -- all 6 legacy buckets', () => {
    it.each(LEGACY_RATINGS)('produces non-empty copy for %s with no score gap available', (rating) => {
      const copy = moveRatingCoachingCopy(rating, 'precise');
      expect(copy).toBeTruthy();
      expect(copy!.length).toBeGreaterThan(0);
    });

    it.each(LEGACY_RATINGS.filter((r) => r !== 'Brilliant'))(
      'cites the real score gap for %s when one is available',
      (rating) => {
        const copy = moveRatingCoachingCopy(rating, 'precise', 2.5);
        expect(copy).toContain('2.5');
      },
    );

    it('does not fabricate a gap citation for Brilliant even when a gap is passed', () => {
      // Brilliant means an exact match with the best option -- there is no
      // real gap to cite, so the copy must never claim a number for it.
      const copy = moveRatingCoachingCopy('Brilliant', 'precise', 2.5);
      expect(copy).not.toContain('2.5');
    });
  });

  describe('heuristic tier -- 3 heuristic buckets, qualitative only', () => {
    it.each(HEURISTIC_RATINGS)('produces non-empty, number-free copy for %s', (rating) => {
      const copy = moveRatingCoachingCopy(rating, 'heuristic');
      expect(copy).toBeTruthy();
      expect(copy).not.toMatch(/\d/);
    });

    it('ignores a score gap even if one is passed -- heuristic scores are not real point differentials', () => {
      const copy = moveRatingCoachingCopy('Blunder', 'heuristic', 5);
      expect(copy).not.toMatch(/\d/);
    });

    it.each(HEURISTIC_RATINGS)('%s heuristic-tier copy is distinct from its precise-tier copy', (rating) => {
      const heuristicCopy = moveRatingCoachingCopy(rating, 'heuristic');
      const preciseCopy = moveRatingCoachingCopy(rating, 'precise');
      expect(heuristicCopy).not.toBe(preciseCopy);
    });
  });

  it('all 9 rating/tier combinations produce distinct, non-empty copy', () => {
    const slots = new Set<string>();
    for (const rating of LEGACY_RATINGS) {
      const copy = moveRatingCoachingCopy(rating, 'precise');
      expect(copy).toBeTruthy();
      slots.add(copy!);
    }
    for (const rating of HEURISTIC_RATINGS) {
      const copy = moveRatingCoachingCopy(rating, 'heuristic');
      expect(copy).toBeTruthy();
      slots.add(copy!);
    }
    expect(slots.size).toBe(9);
  });
});
