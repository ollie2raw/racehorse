import type {
  ReviewCandidateEvaluationV1,
  ReviewEvaluationV1,
  ReviewPositionSnapshotV2,
} from '@racehorse/game-core/review';
import { REVIEW_EVALUATION_VERSION } from '@racehorse/game-core/review';

/**
 * B0 (game-review-oracle-upgrade-2026-09-13.md): fixed compute budget for a
 * single evaluateReviewPosition call. Determinism requirement from the doc's
 * Phase B section — "fixed node/sample budgets for determinism (not
 * performance.now() cutoffs)". Unused by this stub; B1-B3 spend it.
 */
export type ReviewSearchBudget = {
  readonly maxNodes: number;
  readonly maxHiddenStateSamples: number;
};

function candidateFromSnapshot(snapshot: ReviewPositionSnapshotV2): ReviewCandidateEvaluationV1 {
  return {
    action: snapshot.actualAction,
    // No evaluation has actually run — a real expectedPointDifferential /
    // winProbability claim would be fabricated. immediatePoints is the one
    // real, already-known fact about this decision (it's what happened),
    // not an invented one.
    value: { expectedPointDifferential: 0, winProbability: null },
    immediatePoints: snapshot.outcome.immediatePoints,
    principalVariation: [],
  };
}

/**
 * B0 package skeleton. Returns a heuristic-only, low-confidence stub — no
 * real search, no hidden-state sampling, no opponent-hand or boneyard
 * fabrication (there is nothing here to fabricate: `played`/`best` are the
 * same known-real action, `best` claims no improvement over `played` because
 * none was actually evaluated). B1-B4 replace this body; the shape and the
 * evidence-source/confidence contract do not change out from under them.
 */
export function evaluateReviewPosition(
  snapshot: ReviewPositionSnapshotV2,
  _budget: ReviewSearchBudget,
): ReviewEvaluationV1 {
  const played = candidateFromSnapshot(snapshot);

  return {
    evaluationVersion: REVIEW_EVALUATION_VERSION,
    snapshotId: snapshot.identifiers.decisionId,
    rulesVersion: snapshot.rulesVersion,
    reviewEngineVersion: snapshot.reviewEngineVersion,
    evidence: {
      source: 'heuristic',
      confidence: 'low',
      displayLabel: 'Heuristic estimate',
    },
    played,
    // No real comparison performed yet — best is honestly reported as the
    // played action itself, not an invented "better" move.
    best: played,
    candidates: [played],
    loss: { expectedPointDifferential: 0, winProbability: null },
    search: {
      nodes: 0,
      depth: 0,
      hiddenStateSamples: 0,
      coverage: 0,
      complete: false,
    },
    diagnostics: ['B0 stub: no real evaluation performed'],
  };
}
