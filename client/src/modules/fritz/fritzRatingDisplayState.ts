import { roundedRatingDelta } from '../ghost/ghostMatchHelpers.ts';

export type FritzRatingPrediction = {
  glickoRating: number;
  glickoDelta: number;
};

export type FritzRatingGhostResult = {
  glickoRating?: number | null;
  glickoDelta?: number | null;
};

export type FritzRatingDisplayState = {
  fritzGlickoDelta: number | null;
  fritzNewGlickoRating: number | null;
  hasConfirmedFritzRatingUpdate: boolean;
  showFritzRatingSyncing: boolean;
};

/**
 * Derive post-game Fritz rating UI fields.
 *
 * Prediction is display-only (pending/syncing). Confirmed + profile authority
 * require a server `ghostResult` — never the client prediction alone.
 */
export function deriveFritzRatingDisplayState(input: {
  isGhostMode: boolean;
  ghostResult: FritzRatingGhostResult | null;
  predictedFritzGlicko: FritzRatingPrediction | null;
  ghostResultLoading: boolean;
  matchStartGlickoRating: number | null;
}): FritzRatingDisplayState {
  const { isGhostMode, ghostResult, predictedFritzGlicko, ghostResultLoading, matchStartGlickoRating } =
    input;

  if (isGhostMode) {
    return {
      fritzGlickoDelta: null,
      fritzNewGlickoRating: null,
      hasConfirmedFritzRatingUpdate: false,
      showFritzRatingSyncing: false,
    };
  }

  const hasConfirmedFritzRatingUpdate =
    ghostResult != null && (ghostResult.glickoRating != null || ghostResult.glickoDelta != null);

  // Pending: waiting on server. Prediction alone never counts as confirmed.
  const showFritzRatingSyncing =
    ghostResult == null && (ghostResultLoading || predictedFritzGlicko != null);

  const fritzGlickoDelta =
    ghostResult?.glickoDelta != null
      ? roundedRatingDelta(ghostResult.glickoDelta)
      : hasConfirmedFritzRatingUpdate &&
          ghostResult?.glickoRating != null &&
          matchStartGlickoRating != null
        ? roundedRatingDelta(ghostResult.glickoRating - matchStartGlickoRating)
        : // Prediction is UI-only while syncing; overlay prefers syncing copy.
          predictedFritzGlicko != null
          ? roundedRatingDelta(predictedFritzGlicko.glickoDelta)
          : null;

  const fritzNewGlickoRating =
    ghostResult?.glickoRating != null
      ? Math.round(ghostResult.glickoRating)
      : predictedFritzGlicko != null
        ? predictedFritzGlicko.glickoRating
        : null;

  return {
    fritzGlickoDelta,
    fritzNewGlickoRating,
    hasConfirmedFritzRatingUpdate,
    showFritzRatingSyncing,
  };
}

/** Profile patch rating only from server proof — never from client prediction. */
export function resolveFritzProfilePatchRating(
  ghostResult: FritzRatingGhostResult | null,
): number | null {
  if (ghostResult?.glickoRating == null) return null;
  const rating = Number(ghostResult.glickoRating);
  return Number.isFinite(rating) ? rating : null;
}
