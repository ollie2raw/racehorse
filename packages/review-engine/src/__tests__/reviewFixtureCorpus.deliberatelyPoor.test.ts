import { describe, expect, it } from 'vitest';
import type { ReviewDispatchBudget } from '../evaluateReviewPosition';
import { evaluateReviewPosition } from '../evaluateReviewPosition';
import { isScorable } from '../reviewAccuracy';
// Matches the established convention (client/src/modules/review/captureReviewSnapshotAtDecision.test.ts)
// of importing the fixture corpus by its real source path rather than through
// a package export -- REVIEW_FIXTURE_CORPUS is test-only fixture data, not
// part of game-core's public API surface.
import { REVIEW_FIXTURE_CORPUS } from '../../../game-core/src/reviewFixtureCorpus';

// Same values used throughout evaluateReviewPosition.test.ts, so this test
// exercises the dispatcher under the same realistic conditions as every
// other fixture-driven evaluation in this package.
const REALISTIC_BUDGET: ReviewDispatchBudget = {
  maxNodes: 200_000,
  // Match CALIBRATION_FIXTURE_BUDGET: opening maximal-uncertainty fixtures
  // need >100 samples to clear the 2% coverage diagnostic under the current
  // evidence/hidden-pool enumerator (see deliberately-poor-opening-s21-a10).
  maxHiddenStateSamples: 500,
  maxPlyDepth: 2,
  seed: 'deliberately-poor-fixture-check',
};
const PROVISIONAL_COVERAGE_THRESHOLD = 0.02;

/**
 * C2a-1 (docs/scoping/phase-c-accuracy-model-spec.md, section 5 gap check):
 * proves the new deliberately_poor fixtures aren't just "not the best move"
 * on paper -- run through the REAL evaluateReviewPosition dispatcher (no
 * mocks, no stubbed solver), each one must come back as a scorable decision
 * (per C1's isScorable) with a real, materially nonzero moveLoss. A fixture
 * that only "looks bad" by eye but evaluates to ~0 loss, or that gets routed
 * to the heuristic tier (excluded from scoring entirely), would be useless
 * to C2's calibration harness -- this is the check that catches that.
 */
describe('deliberately_poor fixtures produce a real, scorable, meaningfully-large moveLoss', () => {
  const poorFixtures = REVIEW_FIXTURE_CORPUS.filter((fixture) => fixture.category === 'deliberately_poor');

  it('the corpus actually contains at least two deliberately_poor fixtures', () => {
    expect(poorFixtures.length).toBeGreaterThanOrEqual(2);
  });

  it.each(poorFixtures)('$id: scorable, non-heuristic, with meaningfully-large real moveLoss', (fixture) => {
    const result = evaluateReviewPosition(fixture.snapshot, REALISTIC_BUDGET, PROVISIONAL_COVERAGE_THRESHOLD);

    // Not heuristic-only -- the fixture must have cleared the coverage bar,
    // or it would be excluded from scoring by isScorable regardless of loss.
    expect(result.evidence.source).not.toBe('heuristic');

    // Not forced -- there must have been a real, multi-option choice, or
    // this decision doesn't count as "poor play" (there was nothing else to
    // play).
    expect(isScorable(result, result.candidates)).toBe(true);

    // The actual point: this deliberately-worse play must show up as a real,
    // materially nonzero loss when scored by the real oracle -- not just a
    // hand-picked position that looks weak but evaluates close to optimal.
    expect(result.loss.expectedPointDifferential).toBeGreaterThan(5);
  });
});
