import { describe, expect, it } from 'vitest';
import { computeFritzRatingChange } from './service';

describe('computeFritzRatingChange', () => {
  describe('K-factor tiers', () => {
    it('uses K=40 for provisional players (< 20 games)', () => {
      // Win vs equal (rating=1000) with 0 games should produce |delta| ≤ 40
      const { delta } = computeFritzRatingChange(1000, 3, 0, 0);
      expect(Math.abs(delta)).toBeLessThanOrEqual(40);
    });

    it('uses lower K for established players (>= 50 games)', () => {
      const { delta: provisional } = computeFritzRatingChange(1000, 3, 0, 5);
      const { delta: established } = computeFritzRatingChange(1000, 3, 0, 60);
      // Established player gains less per win than provisional
      expect(Math.abs(established)).toBeLessThan(Math.abs(provisional));
    });

    it('uses K=32 for semi-established players (20–49 games)', () => {
      const { delta: at20 } = computeFritzRatingChange(1000, 3, 0, 20);
      const { delta: at50 } = computeFritzRatingChange(1000, 3, 0, 50);
      // At 20 games K=32, at 50 games K=20 — gain at 20 games should be higher
      expect(Math.abs(at20)).toBeGreaterThan(Math.abs(at50));
    });
  });

  describe('win / loss / margin', () => {
    it('returns positive delta on a win', () => {
      const { delta } = computeFritzRatingChange(1000, 3, 1, 5);
      expect(delta).toBeGreaterThan(0);
    });

    it('returns negative delta on a loss', () => {
      const { delta } = computeFritzRatingChange(1000, 0, 3, 5);
      expect(delta).toBeLessThan(0);
    });

    it('newRating = playerRating + delta', () => {
      const playerRating = 1200;
      const { newRating, delta } = computeFritzRatingChange(playerRating, 3, 1, 10);
      expect(newRating).toBe(playerRating + delta);
    });

    it('larger margin produces larger delta magnitude', () => {
      // Both wins, but one is closer
      const { delta: blowout } = computeFritzRatingChange(1000, 5, 0, 5);
      const { delta: close } = computeFritzRatingChange(1000, 2, 1, 5);
      expect(Math.abs(blowout)).toBeGreaterThan(Math.abs(close));
    });

    it('symmetric: win delta > 0 and loss delta < 0 for same scores', () => {
      const { delta: win } = computeFritzRatingChange(1000, 3, 0, 5);
      const { delta: loss } = computeFritzRatingChange(1000, 0, 3, 5);
      expect(win).toBeGreaterThan(0);
      expect(loss).toBeLessThan(0);
    });
  });

  describe('rating-based expected score', () => {
    it('high-rated player gains less per win than low-rated player', () => {
      // Ghost opponent is fixed at 1000. A 1500-rated player expects to win easily.
      const { delta: highRated } = computeFritzRatingChange(1500, 3, 0, 5);
      const { delta: lowRated } = computeFritzRatingChange(800, 3, 0, 5);
      expect(highRated).toBeLessThan(lowRated);
    });

    it('high-rated player loses more on a loss than a low-rated player', () => {
      const { delta: highRated } = computeFritzRatingChange(1500, 0, 3, 5);
      const { delta: lowRated } = computeFritzRatingChange(800, 0, 3, 5);
      expect(highRated).toBeLessThan(lowRated); // both negative, high-rated more negative
    });
  });

  describe('edge cases', () => {
    it('handles tied score (0–0) without dividing by zero', () => {
      // playerScore + opponentScore = 0, total = max(1, 0) = 1
      expect(() => computeFritzRatingChange(1000, 0, 0, 5)).not.toThrow();
    });

    it('delta is an integer (rounded)', () => {
      const { delta } = computeFritzRatingChange(1000, 3, 1, 5);
      expect(Number.isInteger(delta)).toBe(true);
    });

    it('delta magnitude is bounded by reasonable values', () => {
      // Even with K=40 and maximum marginMultiplier, delta should not exceed ~80
      const { delta } = computeFritzRatingChange(1000, 5, 0, 0);
      expect(Math.abs(delta)).toBeLessThan(100);
    });
  });
});
