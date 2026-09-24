import { isForcedDecision } from '@racehorse/game-core/review';
import type {
  ReviewDecisionLifecycle,
  ReviewEvaluationV1,
  ReviewPositionSnapshotV2,
} from '@racehorse/game-core/review';

/**
 * Fresh-game finalization helpers. Budget exhaustion must NOT become
 * UNAVAILABLE — that path is retired for authoritative fresh reviews.
 */

export function isEvaluationUnavailable(evaluation: ReviewEvaluationV1): boolean {
  // Legacy mixed-version: prior patch wrote unavailableReason. Treat as
  // retryable incomplete, not a success path.
  return evaluation.evaluationProvenance?.unavailableReason != null
    && evaluation.evaluationProvenance?.lifecycle !== 'SCORED'
    && evaluation.evaluationProvenance?.lifecycle !== 'FORCED';
}

export function decisionLifecycle(evaluation: ReviewEvaluationV1): ReviewDecisionLifecycle {
  if (evaluation.evaluationProvenance?.lifecycle) {
    return evaluation.evaluationProvenance.lifecycle;
  }
  if (isForcedDecision(evaluation.candidates)) return 'FORCED';
  if (evaluation.evidence.source === 'exact' || evaluation.evidence.source === 'search') {
    return 'SCORED';
  }
  if (evaluation.evaluationProvenance?.unavailableReason) return 'FAILED_RETRYABLE';
  return 'PENDING';
}

export function needsCompletionReevaluation(evaluation: ReviewEvaluationV1 | undefined): boolean {
  if (!evaluation) return true;
  const life = decisionLifecycle(evaluation);
  if (life === 'SCORED' || life === 'FORCED') return false;
  if (life === 'FAILED_FATAL') return false;
  return true;
}

/** @deprecated Prefer adaptiveEvaluate + completeReviewEvaluations. */
export function markEvaluationUnavailable(
  evaluation: ReviewEvaluationV1,
  reason: NonNullable<ReviewEvaluationV1['evaluationProvenance']>['unavailableReason'],
  detail?: string,
): ReviewEvaluationV1 {
  return {
    ...evaluation,
    evaluationProvenance: {
      phase: 'completion',
      lifecycle: 'FAILED_RETRYABLE',
      unavailableReason: reason,
      failureReason: reason,
      ...(detail ? { detail } : {}),
    },
  };
}

export function annotateLiveEvaluation(evaluation: ReviewEvaluationV1): ReviewEvaluationV1 {
  if (evaluation.evaluationProvenance?.lifecycle) return evaluation;
  const lifecycle = isForcedDecision(evaluation.candidates)
    ? 'FORCED'
    : evaluation.evidence.source === 'exact' || evaluation.evidence.source === 'search'
      ? 'SCORED'
      : 'PENDING';
  return {
    ...evaluation,
    evaluationProvenance: {
      phase: evaluation.evaluationProvenance?.phase ?? 'live',
      lifecycle,
    },
  };
}

export type FinalizeReviewEvaluationsInput = {
  readonly snapshots: readonly ReviewPositionSnapshotV2[];
  readonly resultsByDecisionId: ReadonlyMap<string, ReviewEvaluationV1>;
  readonly errorsByDecisionId: ReadonlyMap<string, unknown>;
  /**
   * When true, annotate residuals as FAILED_RETRYABLE (not UNAVAILABLE) so
   * the durable job can requeue. Never claims COMPLETE while retryable remain.
   */
  readonly completionFinished?: boolean;
};

export type FinalizeReviewEvaluationsResult = {
  readonly resultsByDecisionId: ReadonlyMap<string, ReviewEvaluationV1>;
  readonly reasonCounts: Readonly<Record<string, number>>;
  readonly complete: boolean;
};

/**
 * Annotate lifecycle without inventing UNAVAILABLE finals for budget misses.
 */
export function finalizeReviewEvaluations(
  input: FinalizeReviewEvaluationsInput,
): FinalizeReviewEvaluationsResult {
  const completionFinished = input.completionFinished !== false;
  const next = new Map<string, ReviewEvaluationV1>();
  const reasonCounts: Record<string, number> = {};
  const bump = (reason: string) => {
    reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  };

  const decisionIds = new Set<string>();
  for (const snapshot of input.snapshots) decisionIds.add(snapshot.identifiers.decisionId);
  for (const id of input.resultsByDecisionId.keys()) decisionIds.add(id);
  for (const id of input.errorsByDecisionId.keys()) decisionIds.add(id);

  let pendingOrRetryable = 0;

  for (const decisionId of decisionIds) {
    const existing = input.resultsByDecisionId.get(decisionId);
    const errored = input.errorsByDecisionId.has(decisionId);

    if (errored && !existing) {
      bump('evaluation-error');
      pendingOrRetryable += 1;
      continue;
    }
    if (!existing) {
      bump('missing-snapshot');
      pendingOrRetryable += 1;
      continue;
    }

    const annotated = annotateLiveEvaluation(existing);
    const life = decisionLifecycle(annotated);

    if (life === 'SCORED' || life === 'FORCED') {
      next.set(decisionId, annotated);
      bump(life.toLowerCase());
      continue;
    }

    if (!completionFinished) {
      next.set(decisionId, annotated);
      bump(life.toLowerCase());
      pendingOrRetryable += 1;
      continue;
    }

    // Still incomplete after a pass — mark retryable, never unavailable-final.
    next.set(decisionId, {
      ...annotated,
      evaluationProvenance: {
        phase: 'completion',
        lifecycle: 'FAILED_RETRYABLE',
        failureReason:
          annotated.heuristicFallbackReason === 'locked-yard-infeasible'
            ? 'locked-yard-infeasible'
            : annotated.heuristicFallbackReason === 'globally-infeasible'
              ? 'globally-infeasible'
              : 'coverage-unreachable',
        detail: 'awaiting escalation/retry',
      },
    });
    bump('failed_retryable');
    pendingOrRetryable += 1;
  }

  return {
    resultsByDecisionId: next,
    reasonCounts,
    complete: pendingOrRetryable === 0 && next.size > 0,
  };
}
