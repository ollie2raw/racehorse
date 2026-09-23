import { describe, expect, it } from 'vitest';
import type { ReviewCandidateEvaluationV1, ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { isForcedDecision } from '@racehorse/game-core/review';
import {
  ACCURACY_MODEL_CALIBRATION_VERSION,
  CALIBRATED_K,
  LOSS_BAND_BOUNDARIES,
  V5_CALIBRATION_CORPUS_REVISION,
  V5_FROZEN_RECORDED_SCORABLE_DENOMINATOR,
} from '../accuracyModelCalibration';
import { ACCURACY_MODEL_VERSION, accuracyFromEvaluations, isScorable } from '../reviewAccuracy';
import {
  RECORDED_CLIENT_POLICY_DIR,
  RECORDED_SELF_PLAY_DIR,
  evaluateFixtureCorpus,
  fitKLeastSquares,
  readCorpusDir,
} from '../devtools/calibrateAccuracyModel';

/**
 * v5 forced-semantics migration locks:
 *  - legal-choice eligibility (action-level forced) is separate from
 *  - severity semantics (retained 0.13 / 0.79 / 5.98 loss bands)
 *  - aggregate K is the exact action-level fitKLeastSquares result
 */

const EXACT: ReviewEvaluationV1['evidence'] = {
  source: 'exact',
  confidence: 'high',
  displayLabel: 'Exact analysis',
};

function playCandidate(
  tileLow: number,
  tileHigh: number,
  position: 'left' | 'right',
  value: number,
): ReviewCandidateEvaluationV1 {
  return {
    action: { kind: 'play', tile: { low: tileLow, high: tileHigh }, position },
    value: { expectedPointDifferential: value, winProbability: null },
    immediatePoints: 0,
    principalVariation: [],
  };
}

function evaluationWithLoss(moveLoss: number, candidates: ReviewCandidateEvaluationV1[]): ReviewEvaluationV1 {
  const played = candidates[0]!;
  const best = candidates.reduce((a, b) =>
    b.value.expectedPointDifferential > a.value.expectedPointDifferential ? b : a,
  );
  return {
    evaluationVersion: 1,
    snapshotId: 'v5-band-lock',
    rulesVersion: 1,
    reviewEngineVersion: 'review-engine-v1',
    evidence: EXACT,
    played,
    best,
    candidates,
    loss: { expectedPointDifferential: moveLoss, winProbability: null },
    search: { nodes: candidates.length, depth: 1, hiddenStateSamples: 0, coverage: 1, complete: true },
    diagnostics: [],
  };
}

function bandForLoss(loss: number): 'Best' | 'Inaccuracy' | 'Mistake' | 'Blunder' {
  const { bestTolerance, inaccuracyToMistake, mistakeToBlunder } = LOSS_BAND_BOUNDARIES;
  if (loss <= bestTolerance) return 'Best';
  if (loss <= inaccuracyToMistake) return 'Inaccuracy';
  if (loss <= mistakeToBlunder) return 'Mistake';
  return 'Blunder';
}

describe('v5 loss-band semantic thresholds (retained; not prevalence targets)', () => {
  const { bestTolerance, inaccuracyToMistake, mistakeToBlunder } = LOSS_BAND_BOUNDARIES;

  it('A: loss 0 → Best', () => {
    expect(bandForLoss(0)).toBe('Best');
  });

  it('B: small positive loss within bestTolerance → Best', () => {
    expect(bandForLoss(bestTolerance / 2)).toBe('Best');
    expect(bandForLoss(bestTolerance)).toBe('Best');
  });

  it('C: crossing bestTolerance → Inaccuracy', () => {
    expect(bandForLoss(bestTolerance + 1e-12)).toBe('Inaccuracy');
  });

  it('D: crossing inaccuracyToMistake → Mistake', () => {
    expect(bandForLoss(inaccuracyToMistake)).toBe('Inaccuracy');
    expect(bandForLoss(inaccuracyToMistake + 1e-12)).toBe('Mistake');
  });

  it('E: crossing mistakeToBlunder → Blunder', () => {
    expect(bandForLoss(mistakeToBlunder)).toBe('Mistake');
    expect(bandForLoss(mistakeToBlunder + 1e-12)).toBe('Blunder');
  });

  it('F: published boundaries stay fixed at 0.13 / 0.79 / 5.98 regardless of corpus zero-mass', () => {
    expect(bestTolerance).toBeCloseTo(0.13, 10);
    expect(inaccuracyToMistake).toBe(0.79);
    expect(mistakeToBlunder).toBe(5.98);
  });

  it('G: same-tile multi-placement remains scored when all placements are value-equal', () => {
    const left = playCandidate(3, 5, 'left', 1.0);
    const right = playCandidate(3, 5, 'right', 1.0);
    const evaluation = evaluationWithLoss(0, [left, right]);
    expect(isForcedDecision(evaluation.candidates)).toBe(false);
    expect(isScorable(evaluation, evaluation.candidates)).toBe(true);
    expect(bandForLoss(0)).toBe('Best');
    const result = accuracyFromEvaluations([evaluation]);
    expect(result.status).toBe('computed');
    if (result.status === 'computed') {
      expect(result.accuracy).toBe(100);
      expect(result.scorableCount).toBe(1);
    }
  });
});

describe('v5 aggregate calibration lock', () => {
  it('publishes the exact fitted K and version under action-level forced', () => {
    expect(CALIBRATED_K).toBe(0.20094184929012865);
    expect(ACCURACY_MODEL_CALIBRATION_VERSION).toBe('accuracy-model-v5-action-forced-2026-09-22');
    expect(ACCURACY_MODEL_VERSION).toBe(ACCURACY_MODEL_CALIBRATION_VERSION);
    expect(V5_CALIBRATION_CORPUS_REVISION).toContain('recorded-self-play');
    expect(V5_FROZEN_RECORDED_SCORABLE_DENOMINATOR).toBe(5538);
  });

  it('deterministic recalibration reproduces published K from the frozen recorded corpora', () => {
    const selfPlay = readCorpusDir(RECORDED_SELF_PLAY_DIR);
    const client = readCorpusDir(RECORDED_CLIENT_POLICY_DIR);
    const all = [...selfPlay, ...client];

    let scorable = 0;
    for (const record of all) {
      if (isScorable(record.evaluation, record.evaluation.candidates)) scorable += 1;
    }
    expect(scorable).toBe(V5_FROZEN_RECORDED_SCORABLE_DENOMINATOR);

    const strong = selfPlay
      .filter((r) => r.batchTag === 'strong-policy-top-tier')
      .filter((r) => isScorable(r.evaluation, r.evaluation.candidates))
      .map((r) => r.evaluation.loss.expectedPointDifferential);
    const poor = evaluateFixtureCorpus()
      .filter((f) => f.category === 'deliberately_poor')
      .filter((f) => isScorable(f.evaluation, f.evaluation.candidates))
      .map((f) => f.evaluation.loss.expectedPointDifferential);

    const k = fitKLeastSquares([
      {
        label: 'strong',
        meanLoss: strong.reduce((s, v) => s + v, 0) / strong.length,
        targetAccuracy: 95,
      },
      {
        label: 'poor',
        meanLoss: poor.reduce((s, v) => s + v, 0) / poor.length,
        targetAccuracy: 15,
      },
    ]);
    expect(Math.abs(k - CALIBRATED_K)).toBeLessThan(1e-9);
  });

  it('semantic ordering: strong > ordinary > poor under published K', () => {
    const selfPlay = readCorpusDir(RECORDED_SELF_PLAY_DIR);
    const client = readCorpusDir(RECORDED_CLIENT_POLICY_DIR);
    const strongEvals = selfPlay
      .filter((r) => r.batchTag === 'strong-policy-top-tier')
      .map((r) => r.evaluation);
    const ordinaryEvals = client.filter((r) => r.tier === 'standard').map((r) => r.evaluation);
    const poorEvals = evaluateFixtureCorpus()
      .filter((f) => f.category === 'deliberately_poor')
      .map((f) => f.evaluation);

    const strong = accuracyFromEvaluations(strongEvals);
    const ordinary = accuracyFromEvaluations(ordinaryEvals);
    const poor = accuracyFromEvaluations(poorEvals);
    expect(strong.status).toBe('computed');
    expect(ordinary.status).toBe('computed');
    expect(poor.status).toBe('computed');
    if (strong.status !== 'computed' || ordinary.status !== 'computed' || poor.status !== 'computed') return;
    expect(strong.accuracy).toBeGreaterThan(ordinary.accuracy);
    expect(ordinary.accuracy).toBeGreaterThan(poor.accuracy);
    expect(poor.accuracy).toBeLessThan(60);
    expect(poor.accuracy).toBeGreaterThan(0);
    expect(strong.accuracy).toBeLessThanOrEqual(100);
    expect(ordinary.accuracy).toBeLessThanOrEqual(100);
  });
});
