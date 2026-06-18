import {
  computeGlicko2,
  DEFAULT_RATING,
  DEFAULT_RD,
  DEFAULT_VOL,
  getFritzConfig,
} from './glicko2.ts';

function isFritzRatingEligible(playerScore: number, opponentScore: number): boolean {
  return Math.max(playerScore, opponentScore) >= 10;
}

export type PredictFritzGlickoUpdateInput = {
  fritzId: string;
  playerScore: number;
  opponentScore: number;
  glickoRating?: number | null;
  glickoRd?: number | null;
  glickoVol?: number | null;
  rankedGamesPlayed?: number | null;
};

export type PredictedFritzGlickoUpdate = {
  glickoRating: number;
  glickoDelta: number;
};

/** Mirrors a single-game Fritz `processRatingPeriod` update for instant post-game UI. */
export function predictFritzGlickoUpdate(
  input: PredictFritzGlickoUpdateInput,
): PredictedFritzGlickoUpdate | null {
  const playerScore = Math.round(input.playerScore);
  const opponentScore = Math.round(input.opponentScore);
  if (!isFritzRatingEligible(playerScore, opponentScore)) {
    const rating = Number(input.glickoRating ?? DEFAULT_RATING);
    return { glickoRating: Math.round(rating), glickoDelta: 0 };
  }

  const rating = Number(input.glickoRating ?? DEFAULT_RATING);
  const rd = Number(input.glickoRd ?? DEFAULT_RD);
  const vol = Number(input.glickoVol ?? DEFAULT_VOL);
  const gamesPlayed = Number(input.rankedGamesPlayed ?? 0);
  if (!Number.isFinite(rating) || !Number.isFinite(rd) || !Number.isFinite(vol)) {
    return null;
  }

  const opponent = getFritzConfig(input.fritzId);
  const result = computeGlicko2(
    { rating, rd, vol, gamesPlayed },
    [{ opponent, result: { score: playerScore, opponentScore } }],
  );

  const glickoDelta = result.newRating - rating;
  return {
    glickoRating: Math.round(result.newRating),
    glickoDelta,
  };
}
