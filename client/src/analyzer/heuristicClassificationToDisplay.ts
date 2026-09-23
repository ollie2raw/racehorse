import type { HeuristicClassification } from './classifyHeuristicResult';

export type HeuristicDisplay = {
  readonly label: string;
  readonly ratingClass: string;
  readonly badge: 'heuristic' | 'unclear' | null;
};

/**
 * Maps a HeuristicClassification to GameReviewer sidebar label/class/badge.
 */
export function heuristicClassificationToDisplay(classification: HeuristicClassification): HeuristicDisplay {
  switch (classification.kind) {
    case 'estimate':
      return { label: 'Estimate', ratingClass: 'estimate', badge: 'heuristic' };
    case 'bucket':
      // Research-only path — should not reach production GameReviewer.
      return {
        label: classification.bucket,
        ratingClass: classification.bucket.toLowerCase(),
        badge: 'heuristic',
      };
    case 'unclear':
      return { label: 'Unclear', ratingClass: 'unclear', badge: 'unclear' };
    case 'forced':
      return { label: 'Forced', ratingClass: 'forced', badge: null };
    case 'calibrated':
      return {
        label: classification.label,
        ratingClass: classification.label.toLowerCase(),
        badge: null,
      };
  }
}
