import { describe, expect, it } from 'vitest';
import {
  computeGlicko2,
  decayRD,
  DEFAULT_RD,
  DEFAULT_RATING,
  DEFAULT_VOL,
  displayRating,
  FRITZ_ELITE_ID,
  FRITZ_GRANDMASTER_ID,
  FRITZ_MASTER_ID,
  FRITZ_RATING,
  FRITZ_RD,
  FRITZ_ROOKIE_ID,
  FRITZ_STANDARD_ID,
  getFritzConfig,
  isFritzId,
  isProvisional,
  TAU,
} from './glicko2';

const defaultPlayer = {
  rating: DEFAULT_RATING,
  rd: DEFAULT_RD,
  vol: DEFAULT_VOL,
  gamesPlayed: 5,
};

describe('computeGlicko2', () => {
  it('increases rating on a win against an equal opponent', () => {
    const player = { ...defaultPlayer, rating: 1500, rd: 200 };
    const opponent = { rating: 1500, rd: 100 };
    const { newRating } = computeGlicko2(player, [
      { opponent, result: { score: 3, opponentScore: 1 } },
    ]);
    expect(newRating).toBeGreaterThan(player.rating);
  });

  it('decreases rating on a loss against an equal opponent', () => {
    const player = { ...defaultPlayer, rating: 1500, rd: 200 };
    const opponent = { rating: 1500, rd: 100 };
    const { newRating } = computeGlicko2(player, [
      { opponent, result: { score: 1, opponentScore: 3 } },
    ]);
    expect(newRating).toBeLessThan(player.rating);
  });

  it('barely changes rating on a draw against an equal opponent', () => {
    const player = { ...defaultPlayer, rating: 1500, rd: 200 };
    const opponent = { rating: 1500, rd: 100 };
    const { newRating } = computeGlicko2(player, [
      { opponent, result: { score: 2, opponentScore: 2 } },
    ]);
    // Draw vs equal → near zero delta
    expect(Math.abs(newRating - player.rating)).toBeLessThan(5);
  });

  it('large gain when beating a much stronger opponent', () => {
    const weak = { ...defaultPlayer, rating: 800, rd: 200 };
    const strong = { rating: 1800, rd: 100 };
    const { newRating } = computeGlicko2(weak, [
      { opponent: strong, result: { score: 3, opponentScore: 0 } },
    ]);
    const delta = newRating - weak.rating;
    expect(delta).toBeGreaterThan(50);
  });

  it('small loss when losing to a much stronger opponent', () => {
    const weak = { ...defaultPlayer, rating: 800, rd: 200 };
    const strong = { rating: 1800, rd: 100 };
    const { newRating } = computeGlicko2(weak, [
      { opponent: strong, result: { score: 0, opponentScore: 3 } },
    ]);
    const delta = weak.rating - newRating;
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThan(30); // expected outcome, small penalty
  });

  it('RD decreases after a rated game', () => {
    const player = { ...defaultPlayer, rd: 200 };
    const { newRD } = computeGlicko2(player, [
      { opponent: { rating: 1500, rd: 100 }, result: { score: 3, opponentScore: 1 } },
    ]);
    expect(newRD).toBeLessThan(player.rd);
  });

  it('keeps volatility bounded for normal games', () => {
    const player = { ...defaultPlayer };
    const { newVol } = computeGlicko2(player, [
      { opponent: { rating: 1500, rd: 100 }, result: { score: 3, opponentScore: 1 } },
    ]);
    expect(newVol).toBeGreaterThan(0);
    expect(newVol).toBeLessThan(1);
  });

  it('handles no games (empty game list) without throwing', () => {
    // With no games vInv=0 → v=Infinity; the algorithm must survive gracefully
    expect(() => computeGlicko2(defaultPlayer, [])).not.toThrow();
  });

  it('multiple games aggregate correctly — more wins = higher rating than one win', () => {
    const player = { ...defaultPlayer, rating: 1500, rd: 200 };
    const opponent = { rating: 1500, rd: 100 };
    const { newRating: afterOne } = computeGlicko2(player, [
      { opponent, result: { score: 3, opponentScore: 1 } },
    ]);
    const { newRating: afterTwo } = computeGlicko2(player, [
      { opponent, result: { score: 3, opponentScore: 1 } },
      { opponent, result: { score: 3, opponentScore: 1 } },
    ]);
    expect(afterTwo).toBeGreaterThan(afterOne);
  });
});

describe('decayRD', () => {
  it('increases RD over inactivity (decay period)', () => {
    const player = { ...defaultPlayer, rd: 100 };
    const { newRD } = decayRD(player);
    expect(newRD).toBeGreaterThan(player.rd);
  });

  it('caps decayed RD at DEFAULT_RD', () => {
    const player = { ...defaultPlayer, rd: DEFAULT_RD - 1, vol: 0.6 };
    const { newRD } = decayRD(player);
    expect(newRD).toBeLessThanOrEqual(DEFAULT_RD);
  });
});

describe('isProvisional', () => {
  it('returns true for fewer than 20 games', () => {
    expect(isProvisional(0)).toBe(true);
    expect(isProvisional(19)).toBe(true);
  });

  it('returns false at 20 games', () => {
    expect(isProvisional(20)).toBe(false);
    expect(isProvisional(100)).toBe(false);
  });
});

describe('displayRating', () => {
  it('rounds to nearest integer', () => {
    expect(displayRating(1500.6)).toBe(1501);
    expect(displayRating(1500.4)).toBe(1500);
  });
});

describe('getFritzConfig', () => {
  it('returns rookie config for rookie ID', () => {
    const cfg = getFritzConfig(FRITZ_ROOKIE_ID);
    expect(cfg.difficulty).toBe('casual');
    expect(cfg.rating).toBeLessThan(1000);
    expect(cfg.rd).toBeLessThan(100);
  });

  it('returns standard config for standard ID', () => {
    const cfg = getFritzConfig(FRITZ_STANDARD_ID);
    expect(cfg.difficulty).toBe('standard');
    expect(cfg.rating).toBeGreaterThanOrEqual(1200);
  });

  it('returns elite config for elite ID', () => {
    const cfg = getFritzConfig(FRITZ_ELITE_ID);
    expect(cfg.difficulty).toBe('hard');
    expect(cfg.rating).toBe(FRITZ_RATING);
    expect(cfg.rd).toBe(FRITZ_RD);
  });

  it('returns master config for master ID', () => {
    const cfg = getFritzConfig(FRITZ_MASTER_ID);
    expect(cfg.difficulty).toBe('master');
    expect(cfg.rating).toBeGreaterThan(FRITZ_RATING);
  });

  it('returns grandmaster config for grandmaster ID', () => {
    const cfg = getFritzConfig(FRITZ_GRANDMASTER_ID);
    expect(cfg.difficulty).toBe('grandmaster');
  });

  it('falls back to elite for unknown IDs', () => {
    const cfg = getFritzConfig('unknown-id');
    expect(cfg.difficulty).toBe('hard');
    expect(cfg.rating).toBe(FRITZ_RATING);
  });
});

describe('isFritzId', () => {
  it('recognizes all known fritz IDs', () => {
    expect(isFritzId(FRITZ_ROOKIE_ID)).toBe(true);
    expect(isFritzId(FRITZ_STANDARD_ID)).toBe(true);
    expect(isFritzId(FRITZ_ELITE_ID)).toBe(true);
    expect(isFritzId(FRITZ_MASTER_ID)).toBe(true);
    expect(isFritzId(FRITZ_GRANDMASTER_ID)).toBe(true);
  });

  it('rejects non-fritz IDs', () => {
    expect(isFritzId('11111111-0000-0000-0000-000000000000')).toBe(false);
    expect(isFritzId('')).toBe(false);
  });
});

describe('constants', () => {
  it('TAU is in the standard Glicko-2 recommended range (0.3–1.2)', () => {
    expect(TAU).toBeGreaterThanOrEqual(0.3);
    expect(TAU).toBeLessThanOrEqual(1.2);
  });

  it('DEFAULT_RATING is reasonable starting value', () => {
    expect(DEFAULT_RATING).toBeGreaterThan(600);
    expect(DEFAULT_RATING).toBeLessThan(1200);
  });

  it('DEFAULT_RD represents uncertainty at start', () => {
    expect(DEFAULT_RD).toBeGreaterThan(100);
  });
});
