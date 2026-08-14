// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  computeGlicko2,
  getFritzConfig,
  DEFAULT_RATING,
  DEFAULT_RD,
  DEFAULT_VOL,
  FRITZ_ROOKIE_ID,
  FRITZ_STANDARD_ID,
  FRITZ_ELITE_ID,
  FRITZ_MASTER_ID,
  FRITZ_GRANDMASTER_ID,
  FRITZ_ROOKIE_RATING,
  FRITZ_STANDARD_RATING,
  FRITZ_RATING,
  FRITZ_MASTER_RATING,
  FRITZ_GRANDMASTER_RATING,
} from './glicko2';

describe('Glicko-2 calculations', () => {
  const defaultPlayer = {
    rating: DEFAULT_RATING,
    rd: DEFAULT_RD,
    vol: DEFAULT_VOL,
    gamesPlayed: 0,
  };

  it('1. increases rating when player wins against an equal opponent', () => {
    const games = [
      {
        opponent: { rating: DEFAULT_RATING, rd: DEFAULT_RD },
        result: { score: 60, opponentScore: 20 },
      },
    ];
    const update = computeGlicko2(defaultPlayer, games);
    expect(update.newRating).toBeGreaterThan(defaultPlayer.rating);
  });

  it('2. decreases rating when player loses against an equal opponent', () => {
    const games = [
      {
        opponent: { rating: DEFAULT_RATING, rd: DEFAULT_RD },
        result: { score: 20, opponentScore: 60 },
      },
    ];
    const update = computeGlicko2(defaultPlayer, games);
    expect(update.newRating).toBeLessThan(defaultPlayer.rating);
  });

  it('3. updates rating minimally or stays same on draws with equal opponent', () => {
    const games = [
      {
        opponent: { rating: DEFAULT_RATING, rd: DEFAULT_RD },
        result: { score: 40, opponentScore: 40 },
      },
    ];
    const update = computeGlicko2(defaultPlayer, games);
    // On a draw with an exact equal, rating stays very close to original
    expect(Math.abs(update.newRating - defaultPlayer.rating)).toBeLessThan(1);
  });

  it('4. decreases RD (confidence increases) after playing a game', () => {
    const games = [
      {
        opponent: { rating: DEFAULT_RATING, rd: DEFAULT_RD },
        result: { score: 60, opponentScore: 20 },
      },
    ];
    const update = computeGlicko2(defaultPlayer, games);
    expect(update.newRD).toBeLessThan(defaultPlayer.rd);
  });

  it('5. changes rating more when player has high RD (high uncertainty)', () => {
    const highRDPlayer = { ...defaultPlayer, rd: 350 };
    const lowRDPlayer = { ...defaultPlayer, rd: 50 };
    const games = [
      {
        opponent: { rating: DEFAULT_RATING, rd: DEFAULT_RD },
        result: { score: 60, opponentScore: 20 },
      },
    ];
    const updateHigh = computeGlicko2(highRDPlayer, games);
    const updateLow = computeGlicko2(lowRDPlayer, games);

    const deltaHigh = updateHigh.newRating - highRDPlayer.rating;
    const deltaLow = updateLow.newRating - lowRDPlayer.rating;
    expect(deltaHigh).toBeGreaterThan(deltaLow);
  });

  it('6. changes rating less when opponent has very high RD (opponent is unrated/uncertain)', () => {
    const gamesUncertainOpponent = [
      {
        opponent: { rating: 1200, rd: 350 },
        result: { score: 60, opponentScore: 20 },
      },
    ];
    const gamesCertainOpponent = [
      {
        opponent: { rating: 1200, rd: 50 },
        result: { score: 60, opponentScore: 20 },
      },
    ];

    const updateUncertain = computeGlicko2(defaultPlayer, gamesUncertainOpponent);
    const updateCertain = computeGlicko2(defaultPlayer, gamesCertainOpponent);

    const deltaUncertain = updateUncertain.newRating - defaultPlayer.rating;
    const deltaCertain = updateCertain.newRating - defaultPlayer.rating;
    expect(deltaCertain).toBeGreaterThan(deltaUncertain);
  });

  it('7. gains more rating when beating a higher-rated opponent than a lower-rated one', () => {
    const gamesBeatHigher = [
      {
        opponent: { rating: 1200, rd: DEFAULT_RD },
        result: { score: 60, opponentScore: 20 },
      },
    ];
    const gamesBeatLower = [
      {
        opponent: { rating: 500, rd: DEFAULT_RD },
        result: { score: 60, opponentScore: 20 },
      },
    ];

    const updateHigher = computeGlicko2(defaultPlayer, gamesBeatHigher);
    const updateLower = computeGlicko2(defaultPlayer, gamesBeatLower);

    const deltaHigher = updateHigher.newRating - defaultPlayer.rating;
    const deltaLower = updateLower.newRating - defaultPlayer.rating;
    expect(deltaHigher).toBeGreaterThan(deltaLower);
  });

  it('8. loses less rating when losing to a higher-rated opponent than a lower-rated one', () => {
    const gamesLoseHigher = [
      {
        opponent: { rating: 1200, rd: DEFAULT_RD },
        result: { score: 20, opponentScore: 60 },
      },
    ];
    const gamesLoseLower = [
      {
        opponent: { rating: 500, rd: DEFAULT_RD },
        result: { score: 20, opponentScore: 60 },
      },
    ];

    const updateHigher = computeGlicko2(defaultPlayer, gamesLoseHigher);
    const updateLower = computeGlicko2(defaultPlayer, gamesLoseLower);

    const lossToHigher = defaultPlayer.rating - updateHigher.newRating;
    const lossToLower = defaultPlayer.rating - updateLower.newRating;
    expect(lossToLower).toBeGreaterThan(lossToHigher);
  });

  it('9. handles multiple games in a single rating period calculation', () => {
    const games = [
      {
        opponent: { rating: 900, rd: 80 },
        result: { score: 60, opponentScore: 20 },
      },
      {
        opponent: { rating: 750, rd: 100 },
        result: { score: 10, opponentScore: 60 },
      },
      {
        opponent: { rating: 800, rd: 90 },
        result: { score: 60, opponentScore: 40 },
      },
    ];
    const update = computeGlicko2(defaultPlayer, games);
    expect(update.newRating).toBeDefined();
    expect(update.newRD).toBeLessThan(defaultPlayer.rd);
    expect(update.newVol).toBeDefined();
  });

  it('10. volatility remains bounded and changes reasonably', () => {
    const games = [
      {
        opponent: { rating: 800, rd: 80 },
        result: { score: 60, opponentScore: 20 },
      },
    ];
    const update = computeGlicko2(defaultPlayer, games);
    expect(update.newVol).toBeGreaterThan(0);
    expect(update.newVol).toBeLessThan(1);
  });

  it('11. returns expected config for Fritz Rookie ID', () => {
    const config = getFritzConfig(FRITZ_ROOKIE_ID);
    expect(config.rating).toBe(FRITZ_ROOKIE_RATING);
    expect(config.rd).toBe(50);
  });

  it('12. returns expected config for Fritz Standard ID', () => {
    const config = getFritzConfig(FRITZ_STANDARD_ID);
    expect(config.rating).toBe(FRITZ_STANDARD_RATING);
    expect(config.rd).toBe(50);
  });

  it('13. returns expected config for Fritz Elite ID', () => {
    const config = getFritzConfig(FRITZ_ELITE_ID);
    expect(config.rating).toBe(FRITZ_RATING);
    expect(config.rd).toBe(50);
  });

  it('14. returns expected config for Fritz Master ID', () => {
    const config = getFritzConfig(FRITZ_MASTER_ID);
    expect(config.rating).toBe(FRITZ_MASTER_RATING);
    expect(config.rd).toBe(50);
  });

  it('15. returns expected config for Fritz Grandmaster ID', () => {
    const config = getFritzConfig(FRITZ_GRANDMASTER_ID);
    expect(config.rating).toBe(FRITZ_GRANDMASTER_RATING);
    expect(config.rd).toBe(45);
  });

  it('16. returns default Fritz Elite config for unrecognized IDs', () => {
    const config = getFritzConfig('some-random-guid-fallback');
    expect(config.rating).toBe(FRITZ_RATING);
    expect(config.rd).toBe(50);
  });
});
