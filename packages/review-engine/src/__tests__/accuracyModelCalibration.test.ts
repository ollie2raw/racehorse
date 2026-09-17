import { describe, expect, it } from 'vitest';
import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { evaluateReviewPosition } from '../evaluateReviewPosition';
import { accuracyFromEvaluations, isScorable } from '../reviewAccuracy';
import {
  CALIBRATION_FIXTURE_BUDGET,
  CALIBRATION_FIXTURE_COVERAGE_THRESHOLD,
  RECORDED_CLIENT_POLICY_DIR,
  RECORDED_SELF_PLAY_DIR,
  readCorpusDir,
} from '../devtools/calibrateAccuracyModel';
import { CALIBRATED_K, LOSS_BAND_BOUNDARIES } from '../accuracyModelCalibration';
// Same convention reviewFixtureCorpus.deliberatelyPoor.test.ts already uses.
import { REVIEW_FIXTURE_CORPUS } from '../../../game-core/src/reviewFixtureCorpus';

/**
 * C2b (docs/scoping/phase-c-accuracy-model-spec.md, section 5 step 4): the
 * real, checked-in acceptance tests over the calibrated constants published
 * in ../accuracyModelCalibration.ts. Every input here is real -- recorded
 * corpus data read straight from packages/review-engine/fixtures/, or a
 * hand-authored fixture run through the real evaluateReviewPosition
 * dispatcher -- with the sole exception of item 4's monotonicity check,
 * which needs a genuinely "strictly worse" counterfactual and so overrides
 * `loss` on real evaluation shapes rather than fabricating evaluations from
 * nothing.
 *
 * Scope reminder (task-level, not spec-level): these tests exercise
 * accuracyFromEvaluations with the FITTED CALIBRATED_K passed explicitly --
 * they do not touch reviewAccuracy.ts's shipped UNCALIBRATED_DEFAULT_K or
 * ACCURACY_MODEL_VERSION, and nothing here is imported by moveAnalyzer.ts
 * or any shipping code.
 */

function withOverriddenLoss(evaluation: ReviewEvaluationV1, expectedPointDifferential: number): ReviewEvaluationV1 {
  return {
    ...evaluation,
    loss: { expectedPointDifferential, winProbability: evaluation.loss.winProbability },
  };
}

const selfPlayRecords = readCorpusDir(RECORDED_SELF_PLAY_DIR);
const clientPolicyRecords = readCorpusDir(RECORDED_CLIENT_POLICY_DIR);

const strongPolicyEvaluations = selfPlayRecords
  .filter((record) => record.batchTag === 'strong-policy-top-tier')
  .map((record) => record.evaluation);
const ordinaryPvfEvaluations = clientPolicyRecords
  .filter((record) => record.tier === 'standard')
  .map((record) => record.evaluation);

const worstLegalFixtures = REVIEW_FIXTURE_CORPUS.filter((fixture) => fixture.category === 'deliberately_poor');
const worstLegalEvaluations = worstLegalFixtures.map((fixture) =>
  evaluateReviewPosition(fixture.snapshot, CALIBRATION_FIXTURE_BUDGET, CALIBRATION_FIXTURE_COVERAGE_THRESHOLD),
);

const forcedMoveFixture = REVIEW_FIXTURE_CORPUS.find((fixture) => fixture.category === 'forced_move');
if (!forcedMoveFixture) throw new Error('Test setup: reviewFixtureCorpus.ts has no forced_move fixture.');
const forcedMoveEvaluation = evaluateReviewPosition(
  forcedMoveFixture.snapshot,
  CALIBRATION_FIXTURE_BUDGET,
  CALIBRATION_FIXTURE_COVERAGE_THRESHOLD,
);

describe('test setup sanity -- the real inputs these acceptance tests depend on', () => {
  it('found at least 2 worst_legal (deliberately_poor) fixtures', () => {
    expect(worstLegalFixtures.length).toBeGreaterThanOrEqual(2);
  });

  it('every worst_legal fixture evaluation is scorable (non-forced, non-heuristic)', () => {
    for (const evaluation of worstLegalEvaluations) {
      expect(isScorable(evaluation, evaluation.candidates)).toBe(true);
    }
  });

  it('the forced_move fixture is genuinely forced (not scorable)', () => {
    expect(isScorable(forcedMoveEvaluation, forcedMoveEvaluation.candidates)).toBe(false);
  });

  it('found real scorable decisions in both recorded corpora', () => {
    expect(strongPolicyEvaluations.filter((e) => isScorable(e, e.candidates)).length).toBeGreaterThan(0);
    expect(ordinaryPvfEvaluations.filter((e) => isScorable(e, e.candidates)).length).toBeGreaterThan(0);
  });
});

describe('published artifact sanity -- accuracyModelCalibration.ts', () => {
  it('the three loss-band boundaries are strictly increasing and non-negative', () => {
    const { bestTolerance, inaccuracyToMistake, mistakeToBlunder } = LOSS_BAND_BOUNDARIES;
    expect(bestTolerance).toBeGreaterThanOrEqual(0);
    expect(inaccuracyToMistake).toBeGreaterThan(bestTolerance);
    expect(mistakeToBlunder).toBeGreaterThan(inaccuracyToMistake);
  });

  it('CALIBRATED_K is a real positive finite number', () => {
    expect(CALIBRATED_K).toBeGreaterThan(0);
    expect(Number.isFinite(CALIBRATED_K)).toBe(true);
  });
});

describe('C0 section 5 step 4 acceptance test: monotonicity', () => {
  it('a strictly-worse decision set never scores higher than the original', () => {
    const scorable = ordinaryPvfEvaluations.filter((e) => isScorable(e, e.candidates));
    expect(scorable.length).toBeGreaterThan(5);

    const original = accuracyFromEvaluations(scorable, CALIBRATED_K);
    // Strictly worse: every loss increases by a fixed real amount. Not a
    // no-op -- if accuracyFromEvaluations were, say, accidentally reading
    // `played`/`best` instead of `loss`, or ignoring `loss` entirely, this
    // perturbation would silently produce the SAME accuracy and this test
    // would catch it.
    const worse = scorable.map((e) => withOverriddenLoss(e, e.loss.expectedPointDifferential + 3));
    const worseResult = accuracyFromEvaluations(worse, CALIBRATED_K);

    expect(original.status).toBe('computed');
    expect(worseResult.status).toBe('computed');
    if (original.status !== 'computed' || worseResult.status !== 'computed') return;
    expect(worseResult.accuracy).toBeLessThan(original.accuracy);
  });

  it('a strictly-better decision set never scores lower than the original', () => {
    const scorable = strongPolicyEvaluations.filter((e) => isScorable(e, e.candidates) && e.loss.expectedPointDifferential > 0);
    expect(scorable.length).toBeGreaterThan(0);

    const original = accuracyFromEvaluations(scorable, CALIBRATED_K);
    const better = scorable.map((e) => withOverriddenLoss(e, Math.max(0, e.loss.expectedPointDifferential - 0.1)));
    const betterResult = accuracyFromEvaluations(better, CALIBRATED_K);

    expect(original.status).toBe('computed');
    expect(betterResult.status).toBe('computed');
    if (original.status !== 'computed' || betterResult.status !== 'computed') return;
    expect(betterResult.accuracy).toBeGreaterThan(original.accuracy);
  });
});

describe('C0 section 5 step 4 acceptance test: forced-move invariance', () => {
  it('adding forced decisions to an evaluation set never changes the resulting accuracy', () => {
    const scorable = strongPolicyEvaluations.filter((e) => isScorable(e, e.candidates));
    expect(scorable.length).toBeGreaterThan(0);

    const baseline = accuracyFromEvaluations(scorable, CALIBRATED_K);
    const withForcedAdded = accuracyFromEvaluations(
      [forcedMoveEvaluation, ...scorable, forcedMoveEvaluation, forcedMoveEvaluation],
      CALIBRATED_K,
    );

    expect(baseline.status).toBe('computed');
    expect(withForcedAdded.status).toBe('computed');
    if (baseline.status !== 'computed' || withForcedAdded.status !== 'computed') return;
    expect(withForcedAdded.accuracy).toBe(baseline.accuracy);
    expect(withForcedAdded.scorableCount).toBe(baseline.scorableCount);
  });

  it('removing forced decisions from an evaluation set never changes the resulting accuracy', () => {
    const scorable = strongPolicyEvaluations.filter((e) => isScorable(e, e.candidates));
    expect(scorable.length).toBeGreaterThan(0);

    const withForced = [forcedMoveEvaluation, ...scorable];
    const withForcedResult = accuracyFromEvaluations(withForced, CALIBRATED_K);
    const withoutForcedResult = accuracyFromEvaluations(scorable, CALIBRATED_K);

    expect(withForcedResult.status).toBe('computed');
    expect(withoutForcedResult.status).toBe('computed');
    if (withForcedResult.status !== 'computed' || withoutForcedResult.status !== 'computed') return;
    expect(withForcedResult.accuracy).toBe(withoutForcedResult.accuracy);
  });

  it('an evaluation set consisting ONLY of forced decisions is "no-scorable-decisions", not a fabricated 0 or 100', () => {
    const result = accuracyFromEvaluations([forcedMoveEvaluation, forcedMoveEvaluation], CALIBRATED_K);
    expect(result.status).toBe('no-scorable-decisions');
  });
});

describe('C0 section 5 step 4 acceptance test: optimal-game ceiling', () => {
  it('an evaluation set where every scorable decision has moveLoss = 0 produces accuracy === 100 exactly', () => {
    const scorable = ordinaryPvfEvaluations.filter((e) => isScorable(e, e.candidates));
    expect(scorable.length).toBeGreaterThan(0);

    // Item 2: a real corpus's decision shape, with played forced to equal
    // best (and loss forced to 0) for every entry -- an "oracle self-play"
    // trajectory is definable this way without a new capture harness.
    const optimalSet = scorable.map((e) => ({
      ...withOverriddenLoss(e, 0),
      played: e.best,
    }));

    const result = accuracyFromEvaluations(optimalSet, CALIBRATED_K);
    expect(result.status).toBe('computed');
    if (result.status !== 'computed') return;
    expect(result.accuracy).toBe(100);
  });
});

describe('accuracyFromEvaluations default parameter -- the path gameAccuracyModel.ts actually relies on', () => {
  it('calling accuracyFromEvaluations with no k argument produces the exact same result as passing CALIBRATED_K explicitly', () => {
    // gameAccuracyModel.ts calls accuracyFromEvaluations(evaluations) with no
    // second argument -- every other test in this file passes CALIBRATED_K
    // explicitly, which re-verifies the constant but never exercises the
    // default parameter itself. This is the one test that does.
    const scorable = ordinaryPvfEvaluations.filter((e) => isScorable(e, e.candidates));
    expect(scorable.length).toBeGreaterThan(0);

    const defaultResult = accuracyFromEvaluations(scorable);
    const explicitResult = accuracyFromEvaluations(scorable, CALIBRATED_K);

    expect(defaultResult).toEqual(explicitResult);
  });
});

describe('C0 section 5 step 4 acceptance test: poor-play floor', () => {
  it('a deliberately-poor evaluation set scores meaningfully separated from the ceiling, with no floor inflation', () => {
    const result = accuracyFromEvaluations(worstLegalEvaluations, CALIBRATED_K);
    expect(result.status).toBe('computed');
    if (result.status !== 'computed') return;

    // Real, falsifiable bounds -- not "any positive k trivially passes".
    // With CALIBRATED_K fitted against a target accuracy of 15 for this
    // exact category (see calibrateAccuracyModel.ts), worst_legal's real
    // predicted mean accuracy is ~15.5; a k too small to separate poor play
    // from the ceiling would fail the < 60 bound below (the literal
    // "everyone gets at least a 60" failure mode the spec names), and a k
    // large enough to floor-clamp everything to 0 would fail the > 0 bound.
    expect(result.accuracy).toBeLessThan(60);
    expect(result.accuracy).toBeGreaterThan(0);
  });
});
