// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  classifyMoveByDelta,
  computeEngineConfidence,
  computeInterventionLevel,
  formatMoveNotation,
  isAmbiguousGap,
  normalizeMoveId,
} from './moveAnalysis';
import { DEFAULT_THRESHOLD_CONFIG } from './types';

describe('normalizeMoveId', () => {
  it('formats play moves and pass', () => {
    expect(normalizeMoveId({ type: 'pass' })).toBe('pass');
    expect(
      normalizeMoveId({ type: 'play', tile: { low: 3, high: 4 }, position: 'left' }),
    ).toBe('3|4-left');
  });
});

describe('formatMoveNotation', () => {
  it('renders human-readable labels', () => {
    expect(formatMoveNotation({ type: 'pass' })).toBe('Pass');
    expect(
      formatMoveNotation({ type: 'play', tile: { low: 3, high: 4 }, position: 'right' }),
    ).toBe('[3|4] → right');
  });
});

describe('classifyMoveByDelta', () => {
  const thresholds = DEFAULT_THRESHOLD_CONFIG;

  it('maps score deltas to categories', () => {
    expect(classifyMoveByDelta(0, thresholds)).toBe('best');
    expect(classifyMoveByDelta(thresholds.excellentDelta, thresholds)).toBe('excellent');
    expect(classifyMoveByDelta(thresholds.goodDelta, thresholds)).toBe('good');
    expect(classifyMoveByDelta(thresholds.dubiousDelta, thresholds)).toBe('dubious');
    expect(classifyMoveByDelta(thresholds.dubiousDelta + 1, thresholds)).toBe('blunder');
  });
});

describe('computeEngineConfidence', () => {
  const thresholds = DEFAULT_THRESHOLD_CONFIG;

  it('returns 1 when only one scored move exists', () => {
    expect(computeEngineConfidence([42], thresholds)).toBe(1);
  });

  it('returns 0 for ambiguous gaps and 1 for strong gaps', () => {
    expect(
      computeEngineConfidence(
        [100, 100 - thresholds.lowConfidenceBand],
        thresholds,
      ),
    ).toBe(0);
    expect(
      computeEngineConfidence(
        [100, 100 - thresholds.strongInterventionDelta],
        thresholds,
      ),
    ).toBe(1);
  });
});

describe('isAmbiguousGap', () => {
  const thresholds = DEFAULT_THRESHOLD_CONFIG;

  it('detects close top-two scores', () => {
    expect(isAmbiguousGap([50, 49], thresholds)).toBe(true);
    expect(isAmbiguousGap([50, 10], thresholds)).toBe(false);
    expect(isAmbiguousGap([50], thresholds)).toBe(false);
  });
});

describe('computeInterventionLevel', () => {
  it('stays silent for best moves and ambiguous non-blunders', () => {
    expect(computeInterventionLevel('best', 1, false)).toBe('none');
    expect(computeInterventionLevel('good', 0.1, true)).toBe('none');
  });

  it('escalates blunders and softens neither-scores positions', () => {
    expect(computeInterventionLevel('blunder', 1, false)).toBe('strong');
    expect(computeInterventionLevel('blunder', 1, false, 'guided', true)).toBe('medium');
    expect(computeInterventionLevel('dubious', 1, false, 'guided', true)).toBe('light');
  });
});