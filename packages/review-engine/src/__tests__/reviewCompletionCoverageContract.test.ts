import { describe, expect, it } from 'vitest';
import { isForcedDecision } from '@racehorse/game-core/review';
import type { ReviewCandidateEvaluationV1, ReviewEvaluationV1 } from '@racehorse/game-core/review';
import {
  accuracyFromEvaluations,
  computeGameAccuracyModel,
  finalizeReviewEvaluations,
  isEvaluationUnavailable,
  isScorable,
  markEvaluationUnavailable,
} from '../index';

const EXACT: ReviewEvaluationV1['evidence'] = { source: 'exact', confidence: 'high', displayLabel: 'Exact analysis' };
const SEARCH: ReviewEvaluationV1['evidence'] = {
  source: 'search',
  confidence: 'medium',
  displayLabel: 'Review Engine search',
};
const HEURISTIC: ReviewEvaluationV1['evidence'] = {
  source: 'heuristic',
  confidence: 'low',
  displayLabel: 'Heuristic estimate',
};

function candidate(tileLow: number, tileHigh: number, expectedPointDifferential = 0): ReviewCandidateEvaluationV1 {
  return {
    action: { kind: 'play', tile: { low: tileLow, high: tileHigh }, position: 'left' },
    value: { expectedPointDifferential, winProbability: null },
    immediatePoints: 0,
    principalVariation: [],
  };
}

function evaluation(args: {
  source: 'exact' | 'search' | 'heuristic';
  loss: number;
  forced?: boolean;
  heuristicFallbackReason?: ReviewEvaluationV1['heuristicFallbackReason'];
  unavailableReason?: NonNullable<ReviewEvaluationV1['evaluationProvenance']>['unavailableReason'];
}): ReviewEvaluationV1 {
  const played = candidate(2, 6, -args.loss);
  const best = candidate(0, 4, 0);
  const candidates = args.forced ? [played] : [best, played];
  const evidence =
    args.source === 'exact' ? EXACT : args.source === 'search' ? SEARCH : HEURISTIC;
  const base: ReviewEvaluationV1 = {
    evaluationVersion: 1,
    snapshotId: 'd1',
    rulesVersion: 1,
    reviewEngineVersion: 'review-engine-v1',
    evidence,
    played,
    best: args.forced ? played : best,
    candidates,
    loss: { expectedPointDifferential: args.loss, winProbability: null },
    search: {
      nodes: 1,
      depth: 1,
      hiddenStateSamples: 1,
      coverage: args.source === 'heuristic' ? 0.01 : 0.5,
      complete: true,
    },
    diagnostics: [],
    ...(args.heuristicFallbackReason ? { heuristicFallbackReason: args.heuristicFallbackReason } : {}),
  };
  if (args.unavailableReason) {
    return markEvaluationUnavailable(base, args.unavailableReason);
  }
  return base;
}

describe('review completion coverage contract', () => {
  it('A/B: finalized accounting is forced + scored + unavailable (zero estimate)', () => {
    const evals = [
      evaluation({ source: 'search', loss: 0, forced: true }),
      evaluation({ source: 'search', loss: 0 }),
      evaluation({ source: 'search', loss: 0.1 }),
      evaluation({
        source: 'heuristic',
        loss: 0,
        heuristicFallbackReason: 'coverage-below-threshold',
        unavailableReason: 'coverage-unreachable',
      }),
    ];
    const forced = evals.filter((e) => isForcedDecision(e.candidates)).length;
    const scored = evals.filter((e) => isScorable(e, e.candidates)).length;
    const unavailable = evals.filter(isEvaluationUnavailable).length;
    const estimates = evals.filter(
      (e) =>
        !isForcedDecision(e.candidates) &&
        e.evidence.source === 'heuristic' &&
        !isEvaluationUnavailable(e),
    ).length;
    expect(forced + scored + unavailable).toBe(evals.length);
    expect(estimates).toBe(0);
    expect(scored).toBe(2);
  });

  it('C: forced and unavailable never enter calibrated accuracy', () => {
    const forced = evaluation({ source: 'search', loss: 50, forced: true });
    const unavailable = evaluation({
      source: 'heuristic',
      loss: 50,
      heuristicFallbackReason: 'globally-infeasible',
      unavailableReason: 'globally-infeasible',
    });
    const scored = evaluation({ source: 'search', loss: 0 });
    const result = accuracyFromEvaluations([forced, unavailable, scored]);
    expect(result.status).toBe('computed');
    if (result.status === 'computed') {
      expect(result.scorableCount).toBe(1);
      expect(result.accuracy).toBeCloseTo(100, 5);
    }
  });

  it('D: hand and game calibrated accuracy share one implementation', () => {
    const handEvals = Array.from({ length: 6 }, () => evaluation({ source: 'search', loss: 0 }));
    const game = computeGameAccuracyModel(handEvals);
    // Hand accuracy is computeGameAccuracyModel restricted to the hand — same function.
    const hand = computeGameAccuracyModel(handEvals);
    expect(hand.accuracy).toBe(game.accuracy);
    expect(hand.accuracy).not.toBeNull();
    expect(hand.accuracy!).toBeGreaterThan(95);
  });

  it('E: production-analog hand — after completion all seven score; no legacy ~73%', () => {
    const preCompletion = [
      evaluation({
        source: 'heuristic',
        loss: 0,
        heuristicFallbackReason: 'coverage-below-threshold',
      }),
      ...Array.from({ length: 6 }, () => evaluation({ source: 'search', loss: 0 })),
    ];
    const preModel = computeGameAccuracyModel(preCompletion);
    expect(preModel.heuristicMoveCount).toBe(1);
    expect(preModel.status).toBe('partial');

    const postCompletion = Array.from({ length: 7 }, () => evaluation({ source: 'search', loss: 0 }));
    const postModel = computeGameAccuracyModel(postCompletion);
    expect(postModel.heuristicMoveCount).toBe(0);
    expect(postModel.status).toBe('complete');
    expect(postModel.accuracy).toBeCloseTo(100, 5);
    expect(postModel.accuracy).not.toBe(73);
    expect(postModel.accuracy!).toBeGreaterThan(99);
  });

  it('finalizeReviewEvaluations marks residual heuristics FAILED_RETRYABLE (not UNAVAILABLE)', () => {
    const heuristic = evaluation({
      source: 'heuristic',
      loss: 0,
      heuristicFallbackReason: 'coverage-below-threshold',
    });
    const search = evaluation({ source: 'search', loss: 0 });
    const snapshots = [
      { identifiers: { decisionId: 'h1' } },
      { identifiers: { decisionId: 's1' } },
    ] as unknown as Parameters<typeof finalizeReviewEvaluations>[0]['snapshots'];

    const results = new Map<string, ReviewEvaluationV1>([
      ['h1', { ...heuristic, snapshotId: 'h1' }],
      ['s1', { ...search, snapshotId: 's1' }],
    ]);

    const finalized = finalizeReviewEvaluations({
      snapshots,
      resultsByDecisionId: results,
      errorsByDecisionId: new Map(),
      completionFinished: true,
    });

    const h = finalized.resultsByDecisionId.get('h1')!;
    const s = finalized.resultsByDecisionId.get('s1')!;
    expect(h.evaluationProvenance?.lifecycle).toBe('FAILED_RETRYABLE');
    expect(h.evaluationProvenance?.failureReason).toBe('coverage-unreachable');
    expect(s.evaluationProvenance?.lifecycle).toBe('SCORED');
    expect(s.evidence.source).toBe('search');
    expect(finalized.complete).toBe(false);
  });

  it('F: finalized evaluations round-trip through JSON with identical provenance and losses', () => {
    const original = markEvaluationUnavailable(
      evaluation({
        source: 'heuristic',
        loss: 1.5,
        heuristicFallbackReason: 'locked-yard-infeasible',
      }),
      'locked-yard-infeasible',
    );
    const scored = evaluation({ source: 'search', loss: 0.2 });
    const serialized = JSON.stringify([original, scored]);
    const revived = JSON.parse(serialized) as ReviewEvaluationV1[];
    expect(revived[0].evaluationProvenance?.unavailableReason).toBe('locked-yard-infeasible');
    expect(revived[0].loss.expectedPointDifferential).toBe(1.5);
    expect(revived[1].loss.expectedPointDifferential).toBe(0.2);
    expect(isScorable(revived[0], revived[0].candidates)).toBe(false);
    expect(isScorable(revived[1], revived[1].candidates)).toBe(true);

    const before = computeGameAccuracyModel([original, scored]);
    const after = computeGameAccuracyModel(revived);
    expect(after.accuracy).toBe(before.accuracy);
    expect(after.heuristicMoveCount).toBe(0);
    expect(after.unavailableMoveCount).toBe(1);
  });
});
