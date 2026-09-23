import { describe, expect, it } from 'vitest';
import type { HeuristicClassification } from './classifyHeuristicResult';
import { heuristicClassificationToDisplay } from './heuristicClassificationToDisplay';

describe('heuristicClassificationToDisplay', () => {
  it('forced -> Forced/forced, no badge', () => {
    const classification: HeuristicClassification = { kind: 'forced' };
    expect(heuristicClassificationToDisplay(classification)).toEqual({
      label: 'Forced',
      ratingClass: 'forced',
      badge: null,
    });
  });

  it('estimate -> Estimate/estimate, heuristic badge', () => {
    const classification: HeuristicClassification = { kind: 'estimate', matchedPrimary: true };
    expect(heuristicClassificationToDisplay(classification)).toEqual({
      label: 'Estimate',
      ratingClass: 'estimate',
      badge: 'heuristic',
    });
  });

  it('unclear/primary-absent -> Unclear', () => {
    const classification: HeuristicClassification = { kind: 'unclear', reason: 'primary-absent' };
    expect(heuristicClassificationToDisplay(classification)).toEqual({
      label: 'Unclear',
      ratingClass: 'unclear',
      badge: 'unclear',
    });
  });

  it('calibrated/Mistake -> Mistake, no badge', () => {
    const classification: HeuristicClassification = { kind: 'calibrated', label: 'Mistake' };
    expect(heuristicClassificationToDisplay(classification)).toEqual({
      label: 'Mistake',
      ratingClass: 'mistake',
      badge: null,
    });
  });
});
