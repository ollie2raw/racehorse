import { describe, expect, it } from 'vitest';
import type { ReviewCandidateEvaluationV1, ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { accuracyFromEvaluations, isScorable, UNCALIBRATED_DEFAULT_K } from '../reviewAccuracy';

const EXACT: ReviewEvaluationV1['evidence'] = { source: 'exact', confidence: 'high', displayLabel: 'Exact analysis' };
const HEURISTIC: ReviewEvaluationV1['evidence'] = { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' };

function candidate(tileLow: number, tileHigh: number, expectedPointDifferential = 0): ReviewCandidateEvaluationV1 {
  return {
    action: { kind: 'play', tile: { low: tileLow, high: tileHigh }, position: 'left' },
    value: { expectedPointDifferential, winProbability: null },
    immediatePoints: 0,
    principalVariation: [],
  };
}

/** A scorable (non-forced, non-heuristic) decision with the given moveLoss. */
function scorableDecision(moveLoss: number): ReviewEvaluationV1 {
  const best = candidate(5, 6, moveLoss);
  const played = candidate(0, 1, 0);
  const candidates = [played, best];
  return {
    evaluationVersion: 1,
    snapshotId: 'x',
    rulesVersion: 1,
    reviewEngineVersion: 'review-engine-v1',
    evidence: EXACT,
    played,
    best,
    candidates,
    loss: { expectedPointDifferential: moveLoss, winProbability: null },
    search: { nodes: 2, depth: 1, hiddenStateSamples: 0, coverage: 1, complete: true },
    diagnostics: [],
  };
}

/** A forced decision (single real candidate) -- excluded from the denominator regardless of loss. */
function forcedDecision(): ReviewEvaluationV1 {
  const only = candidate(2, 2, 0);
  return {
    evaluationVersion: 1,
    snapshotId: 'x',
    rulesVersion: 1,
    reviewEngineVersion: 'review-engine-v1',
    evidence: EXACT,
    played: only,
    best: only,
    candidates: [only],
    loss: { expectedPointDifferential: 0, winProbability: null },
    search: { nodes: 1, depth: 1, hiddenStateSamples: 0, coverage: 1, complete: true },
    diagnostics: [],
  };
}

/** A heuristic-only decision -- excluded from the denominator, loss is meaningless (always 0). */
function heuristicDecision(): ReviewEvaluationV1 {
  const best = candidate(5, 6, 0);
  const played = candidate(0, 1, 0);
  return {
    evaluationVersion: 1,
    snapshotId: 'x',
    rulesVersion: 1,
    reviewEngineVersion: 'review-engine-v1',
    evidence: HEURISTIC,
    played,
    best,
    candidates: [played, best],
    loss: { expectedPointDifferential: 0, winProbability: null },
    search: { nodes: 0, depth: 0, hiddenStateSamples: 0, coverage: 0, complete: false },
    diagnostics: [],
    heuristicFallbackReason: 'coverage-below-threshold',
  };
}

describe('isScorable', () => {
  it('is false for a forced decision (single distinct candidate)', () => {
    const decision = forcedDecision();
    expect(isScorable(decision, decision.candidates)).toBe(false);
  });

  it('is false for a heuristic-only decision', () => {
    const decision = heuristicDecision();
    expect(isScorable(decision, decision.candidates)).toBe(false);
  });

  it('is true for a non-forced, non-heuristic (exact/search) decision', () => {
    const decision = scorableDecision(3);
    expect(isScorable(decision, decision.candidates)).toBe(true);
  });
});

describe('accuracyFromEvaluations -- zero-scorable-decisions edge case', () => {
  it('returns the discriminated no-scorable-decisions result, not a fabricated number, for an empty set', () => {
    expect(accuracyFromEvaluations([])).toEqual({ status: 'no-scorable-decisions' });
  });

  it('returns no-scorable-decisions when every entry is forced or heuristic-only', () => {
    const result = accuracyFromEvaluations([forcedDecision(), heuristicDecision()]);
    expect(result).toEqual({ status: 'no-scorable-decisions' });
  });
});

describe('accuracyFromEvaluations -- optimal-game ceiling', () => {
  it('produces exactly accuracy = 100 when every scorable decision has moveLoss = 0', () => {
    const result = accuracyFromEvaluations([scorableDecision(0), scorableDecision(0), scorableDecision(0)]);
    expect(result.status).toBe('computed');
    if (result.status === 'computed') {
      expect(result.accuracy).toBe(100);
      expect(result.scorableCount).toBe(3);
    }
  });
});

describe('accuracyFromEvaluations -- monotonicity', () => {
  it('never scores a set with uniformly higher-or-equal moveLoss above a set with uniformly lower-or-equal moveLoss', () => {
    const lowerLossSet = [scorableDecision(1), scorableDecision(2), scorableDecision(0)];
    const higherLossSet = [scorableDecision(3), scorableDecision(5), scorableDecision(4)];
    const lowerResult = accuracyFromEvaluations(lowerLossSet);
    const higherResult = accuracyFromEvaluations(higherLossSet);
    expect(lowerResult.status).toBe('computed');
    expect(higherResult.status).toBe('computed');
    if (lowerResult.status === 'computed' && higherResult.status === 'computed') {
      expect(lowerResult.accuracy).toBeGreaterThanOrEqual(higherResult.accuracy);
    }
  });

  it('holds across many random-ish pairs of loss sets, not just one hand-picked pair', () => {
    for (let seed = 0; seed < 20; seed++) {
      const a = [seed * 0.1, seed * 0.2 + 1, seed * 0.05];
      const b = a.map((loss) => loss + 0.5 + seed * 0.01);
      const resultA = accuracyFromEvaluations(a.map(scorableDecision));
      const resultB = accuracyFromEvaluations(b.map(scorableDecision));
      if (resultA.status === 'computed' && resultB.status === 'computed') {
        expect(resultA.accuracy).toBeGreaterThanOrEqual(resultB.accuracy);
      }
    }
  });
});

describe('accuracyFromEvaluations -- forced-move invariance', () => {
  it('adding forced decisions to a scorable set never changes the resulting accuracy', () => {
    const base = [scorableDecision(1), scorableDecision(3)];
    const withForced = [...base, forcedDecision(), forcedDecision()];
    const baseResult = accuracyFromEvaluations(base);
    const withForcedResult = accuracyFromEvaluations(withForced);
    expect(baseResult).toEqual(withForcedResult);
  });

  it('removing forced decisions from a set never changes the resulting accuracy', () => {
    const withForced = [forcedDecision(), scorableDecision(2), forcedDecision(), scorableDecision(6)];
    const withoutForced = withForced.filter((d) => d.candidates.length > 1);
    expect(accuracyFromEvaluations(withForced)).toEqual(accuracyFromEvaluations(withoutForced));
  });
});

describe('accuracyFromEvaluations -- heuristic-exclusion correctness', () => {
  it('a set with heuristic-tier decisions mixed in produces the same result as with those decisions removed entirely', () => {
    const withHeuristic = [scorableDecision(2), heuristicDecision(), scorableDecision(4), heuristicDecision()];
    const withoutHeuristic = withHeuristic.filter((d) => d.evidence.source !== 'heuristic');
    expect(accuracyFromEvaluations(withHeuristic)).toEqual(accuracyFromEvaluations(withoutHeuristic));
  });
});

describe('accuracyFromEvaluations -- poor-play floor / separation', () => {
  it('scores a meaningfully-worse evaluation set meaningfully lower than a near-optimal one', () => {
    const nearOptimal = [scorableDecision(0), scorableDecision(0.1), scorableDecision(0.05)];
    const poor = [scorableDecision(20), scorableDecision(25), scorableDecision(30)];
    const nearOptimalResult = accuracyFromEvaluations(nearOptimal);
    const poorResult = accuracyFromEvaluations(poor);
    expect(nearOptimalResult.status).toBe('computed');
    expect(poorResult.status).toBe('computed');
    if (nearOptimalResult.status === 'computed' && poorResult.status === 'computed') {
      // Relative separation, not an absolute threshold -- k is unfit (see UNCALIBRATED_DEFAULT_K).
      expect(nearOptimalResult.accuracy - poorResult.accuracy).toBeGreaterThan(10);
    }
  });
});

describe('accuracyFromEvaluations -- accuracyModelVersion stamping', () => {
  it('stamps a non-empty accuracyModelVersion string on every computed result', () => {
    const result = accuracyFromEvaluations([scorableDecision(1)]);
    expect(result.status).toBe('computed');
    if (result.status === 'computed') {
      expect(typeof result.accuracyModelVersion).toBe('string');
      expect(result.accuracyModelVersion.length).toBeGreaterThan(0);
    }
  });
});

describe('UNCALIBRATED_DEFAULT_K', () => {
  it('is a positive number (required for the mapping to stay monotonically decreasing)', () => {
    expect(UNCALIBRATED_DEFAULT_K).toBeGreaterThan(0);
  });
});
