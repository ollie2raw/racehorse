import { describe, expect, it } from 'vitest';
import type { HeuristicClassification } from './classifyHeuristicResult';
import { heuristicClassificationToDisplay } from './heuristicClassificationToDisplay';

describe('heuristicClassificationToDisplay', () => {
  it('forced -> Forced/forced, no badge (visible, not graded)', () => {
    const classification: HeuristicClassification = { kind: 'forced' };
    expect(heuristicClassificationToDisplay(classification)).toEqual({
      label: 'Forced',
      ratingClass: 'forced',
      badge: null,
    });
  });

  it('unclear/globally-infeasible -> Unclear/unclear, unclear badge', () => {
    const classification: HeuristicClassification = { kind: 'unclear', reason: 'globally-infeasible' };
    expect(heuristicClassificationToDisplay(classification)).toEqual({
      label: 'Unclear',
      ratingClass: 'unclear',
      badge: 'unclear',
    });
  });

  it('unclear/flat-spread -> Unclear/unclear, unclear badge (same display as globally-infeasible)', () => {
    const classification: HeuristicClassification = { kind: 'unclear', reason: 'flat-spread' };
    expect(heuristicClassificationToDisplay(classification)).toEqual({
      label: 'Unclear',
      ratingClass: 'unclear',
      badge: 'unclear',
    });
  });

  it('bucket/Good -> Good/good, heuristic badge (same label/class as the legacy exact-path Good)', () => {
    const classification: HeuristicClassification = { kind: 'bucket', bucket: 'Good' };
    expect(heuristicClassificationToDisplay(classification)).toEqual({
      label: 'Good',
      ratingClass: 'good',
      badge: 'heuristic',
    });
  });

  it('bucket/Inaccuracy -> Inaccuracy/inaccuracy, heuristic badge', () => {
    const classification: HeuristicClassification = { kind: 'bucket', bucket: 'Inaccuracy' };
    expect(heuristicClassificationToDisplay(classification)).toEqual({
      label: 'Inaccuracy',
      ratingClass: 'inaccuracy',
      badge: 'heuristic',
    });
  });

  it('bucket/Blunder -> Blunder/blunder, heuristic badge -- never visually identical to an exact Blunder due to the badge', () => {
    const classification: HeuristicClassification = { kind: 'bucket', bucket: 'Blunder' };
    expect(heuristicClassificationToDisplay(classification)).toEqual({
      label: 'Blunder',
      ratingClass: 'blunder',
      badge: 'heuristic',
    });
  });

  it('D5: calibrated/Mistake -> Mistake/mistake, no badge -- so GameReviewer\'s display?.badge ?? searchTier fallback still shows the search-tier badge', () => {
    const classification: HeuristicClassification = { kind: 'calibrated', label: 'Mistake' };
    expect(heuristicClassificationToDisplay(classification)).toEqual({
      label: 'Mistake',
      ratingClass: 'mistake',
      badge: null,
    });
  });
});
