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
      // Product contract: forced decisions remain visible as FORCED and are
      // excluded from accuracy — never silently graded as Good.
      return { label: 'Forced', ratingClass: 'forced', badge: null };
    case 'calibrated':
      // D5 (game-review-oracle-upgrade-2026-09-13.md Phase D): the
      // calibrated exact/search-evidence label. No badge -- deliberately
      // null, not 'heuristic', so GameReviewer.tsx's `display?.badge ??
      // searchTier` fallback still shows the existing search-tier badge for
      // these moves instead of this display shape suppressing it.
      return {
        label: classification.label,
        ratingClass: classification.label.toLowerCase(),
        badge: null,
      };
  }
}
