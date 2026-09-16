import type { HeuristicClassification } from './classifyHeuristicResult';

export type HeuristicDisplay = {
  readonly label: string;
  readonly ratingClass: string;
  readonly badge: 'heuristic' | 'unclear' | null;
};

/**
 * Phase C render wiring (game-review-oracle-upgrade-2026-09-13.md): maps a
 * HeuristicClassification to the same label/class shape GameReviewer.tsx's
 * legacy rendering already uses (MoveRating string, lowercase ratingClass),
 * plus a badge discriminator so a heuristic-confidence result is never
 * visually indistinguishable from an exact/search one sharing the same
 * bucket color.
 */
export function heuristicClassificationToDisplay(classification: HeuristicClassification): HeuristicDisplay {
  switch (classification.kind) {
    case 'bucket':
      // classification.bucket is already exactly one of the MoveRating
      // strings the legacy system renders directly as its label (confirmed:
      // no separate label-mapping table exists anywhere in
      // moveAnalyzer.ts/GameReviewer.tsx -- MoveRating's own string value
      // IS the display copy). Same lowercase convention as GameReviewer's
      // own ratingClass(rating) helper, so a heuristic "Blunder" gets the
      // same base row color as an exact one -- distinguished by the badge,
      // not a different color, per the product decision.
      return {
        label: classification.bucket,
        ratingClass: classification.bucket.toLowerCase(),
        badge: 'heuristic',
      };
    case 'unclear':
      // Distinct from every bucket's color/style on purpose -- reason
      // ('globally-infeasible' vs 'flat-spread') isn't distinguished in the
      // display shape itself; both render identically as "Unclear" today.
      return { label: 'Unclear', ratingClass: 'unclear', badge: 'unclear' };
    case 'forced':
      // Matches the legacy system's own single-legal-tile precedent
      // exactly (classifyMove: validTiles.length === 1 -> Good(80)) -- same
      // label, same class, no badge, since this isn't a judgment call to
      // flag as uncertain.
      return { label: 'Good', ratingClass: 'good', badge: null };
  }
}
