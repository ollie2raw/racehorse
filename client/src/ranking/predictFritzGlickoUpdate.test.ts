import { describe, it, expect } from 'vitest';
import { predictFritzGlickoUpdate } from './predictFritzGlickoUpdate';
import { DEFAULT_RATING, FRITZ_STANDARD_ID, FRITZ_ROOKIE_ID } from './glicko2';

describe('predictFritzGlickoUpdate', () => {
  const defaultInput = {
    fritzId: FRITZ_STANDARD_ID,
    playerScore: 60,
    opponentScore: 20,
    glickoRating: 1000,
    glickoRd: 100,
    glickoVol: 0.06,
    rankedGamesPlayed: 5,
  };

  it('1. returns positive delta and higher rating on a win', () => {
    const res = predictFritzGlickoUpdate(defaultInput);
    expect(res).not.toBeNull();
    expect(res!.glickoDelta).toBeGreaterThan(0);
    expect(res!.glickoRating).toBeGreaterThan(1000);
  });

  it('2. returns negative delta and lower rating on a loss', () => {
    const res = predictFritzGlickoUpdate({
      ...defaultInput,
      playerScore: 20,
      opponentScore: 60,
    });
    expect(res).not.toBeNull();
    expect(res!.glickoDelta).toBeLessThan(0);
    expect(res!.glickoRating).toBeLessThan(1000);
  });

  it('3. returns zero delta if scores do not meet eligibility threshold (max score < 10)', () => {
    const res = predictFritzGlickoUpdate({
      ...defaultInput,
      playerScore: 9,
      opponentScore: 5,
    });
    expect(res).not.toBeNull();
    expect(res!.glickoDelta).toBe(0);
    expect(res!.glickoRating).toBe(1000);
  });

  it('4. matches eligibility threshold exactly at 10', () => {
    const res = predictFritzGlickoUpdate({
      ...defaultInput,
      playerScore: 10,
      opponentScore: 5,
    });
    expect(res).not.toBeNull();
    expect(res!.glickoDelta).toBeGreaterThan(0);
  });

  it('5. returns null if rating input is Infinity', () => {
    const res = predictFritzGlickoUpdate({
      ...defaultInput,
      glickoRating: Infinity,
    });
    expect(res).toBeNull();
  });

  it('6. returns null if RD input is NaN', () => {
    const res = predictFritzGlickoUpdate({
      ...defaultInput,
      glickoRd: NaN,
    });
    expect(res).toBeNull();
  });

  it('7. returns null if Volatility input is -Infinity', () => {
    const res = predictFritzGlickoUpdate({
      ...defaultInput,
      glickoVol: -Infinity,
    });
    expect(res).toBeNull();
  });

  it('8. falls back to default rating parameters if inputs are null/undefined', () => {
    const res = predictFritzGlickoUpdate({
      fritzId: FRITZ_STANDARD_ID,
      playerScore: 60,
      opponentScore: 20,
      glickoRating: null,
      glickoRd: null,
      glickoVol: null,
      rankedGamesPlayed: null,
    });
    expect(res).not.toBeNull();
    expect(res!.glickoRating).toBeDefined();
  });

  it('9. predicts symmetric changes for equal wins vs equal losses', () => {
    const winRes = predictFritzGlickoUpdate({
      ...defaultInput,
      glickoRating: 1200, // equal to FRITZ_STANDARD_RATING
      playerScore: 60,
      opponentScore: 20,
    });
    const lossRes = predictFritzGlickoUpdate({
      ...defaultInput,
      glickoRating: 1200,
      playerScore: 20,
      opponentScore: 60,
    });
    expect(winRes).not.toBeNull();
    expect(lossRes).not.toBeNull();
    // Deltas should be roughly symmetric
    expect(Math.abs(winRes!.glickoDelta + lossRes!.glickoDelta)).toBeLessThan(5);
  });

  it('10. changes rating more with a high uncertainty (high RD)', () => {
    const lowRdRes = predictFritzGlickoUpdate({
      ...defaultInput,
      glickoRd: 50,
    });
    const highRdRes = predictFritzGlickoUpdate({
      ...defaultInput,
      glickoRd: 250,
    });
    expect(lowRdRes).not.toBeNull();
    expect(highRdRes).not.toBeNull();
    expect(Math.abs(highRdRes!.glickoDelta)).toBeGreaterThan(Math.abs(lowRdRes!.glickoDelta));
  });

  it('11. scores are rounded to integer inside predictor', () => {
    const floatRes = predictFritzGlickoUpdate({
      ...defaultInput,
      playerScore: 59.7,
      opponentScore: 20.2,
    });
    const roundedRes = predictFritzGlickoUpdate({
      ...defaultInput,
      playerScore: 60,
      opponentScore: 20,
    });
    expect(floatRes).toEqual(roundedRes);
  });

  it('12. handles low ratings (flooring/lower bound calculations)', () => {
    const res = predictFritzGlickoUpdate({
      ...defaultInput,
      glickoRating: 300,
      playerScore: 5,
      opponentScore: 60,
      fritzId: FRITZ_ROOKIE_ID,
    });
    expect(res).not.toBeNull();
    // Rating should drop, but formula continues to compute correctly even at low values
    expect(res!.glickoRating).toBeLessThan(300);
  });

  it('13. handles extremely high ratings', () => {
    const res = predictFritzGlickoUpdate({
      ...defaultInput,
      glickoRating: 3000,
      playerScore: 60,
      opponentScore: 10,
    });
    expect(res).not.toBeNull();
    // Beating a 1200 opponent as a 3000 player gives very little rating
    expect(res!.glickoDelta).toBeGreaterThan(0);
    expect(res!.glickoDelta).toBeLessThan(2);
  });

  it('14. uses appropriate Fritz rating config based on fritzId', () => {
    const rookieRes = predictFritzGlickoUpdate({
      ...defaultInput,
      fritzId: FRITZ_ROOKIE_ID,
      glickoRating: 1200,
      playerScore: 60,
      opponentScore: 20,
    });
    const standardRes = predictFritzGlickoUpdate({
      ...defaultInput,
      fritzId: FRITZ_STANDARD_ID,
      glickoRating: 1200,
      playerScore: 60,
      opponentScore: 20,
    });
    // Beating Standard (1200) vs Rookie (800) should yield more rating points
    expect(standardRes!.glickoDelta).toBeGreaterThan(rookieRes!.glickoDelta);
  });

  it('15. behaves reasonably when player draws with Fritz standard', () => {
    const drawRes = predictFritzGlickoUpdate({
      ...defaultInput,
      glickoRating: 1200, // equal to FRITZ_STANDARD_RATING
      playerScore: 40,
      opponentScore: 40,
    });
    expect(drawRes).not.toBeNull();
    expect(Math.abs(drawRes!.glickoDelta)).toBeLessThan(2);
  });
});
