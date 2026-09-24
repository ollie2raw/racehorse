import { isForcedDecision } from '@racehorse/game-core/review';
import type {
  ReviewDecisionLifecycle,
  ReviewEvaluationV1,
  ReviewPositionSnapshotV2,
} from '@racehorse/game-core/review';
import {
  adaptiveEvaluateReviewPosition,
  SEARCH_ESCALATION_TIERS,
  ADAPTIVE_COVERAGE_THRESHOLD,
} from './adaptiveEvaluateReviewPosition';

export { SEARCH_ESCALATION_TIERS, ADAPTIVE_COVERAGE_THRESHOLD };

/** @deprecated Use SEARCH_ESCALATION_TIERS[1].budget — kept for import compatibility. */
export const COMPLETION_REVIEW_DISPATCH_BUDGET = SEARCH_ESCALATION_TIERS[1]!.budget;
export const COMPLETION_REVIEW_COVERAGE_THRESHOLD = ADAPTIVE_COVERAGE_THRESHOLD;

export type CompleteReviewEvaluationsInput = {
  readonly snapshots: readonly ReviewPositionSnapshotV2[];
  readonly liveResultsByDecisionId: ReadonlyMap<string, ReviewEvaluationV1>;
  readonly liveErrorsByDecisionId?: ReadonlyMap<string, unknown>;
  /** Highest escalation tier to attempt this pass (default 4). */
  readonly maxTier?: 1 | 2 | 3 | 4;
  /** Start tier for decisions still needing work (default 2). */
  readonly startTier?: 1 | 2 | 3 | 4;
};

export type CompleteReviewEvaluationsResult = {
  readonly resultsByDecisionId: ReadonlyMap<string, ReviewEvaluationV1>;
  readonly reasonCounts: Readonly<Record<string, number>>;
  readonly lifecycleCounts: Readonly<Record<ReviewDecisionLifecycle, number>>;
  readonly reevaluatedDecisionIds: readonly string[];
  readonly promotedToSearchOrExact: number;
  readonly retryableDecisionIds: readonly string[];
  readonly fatalDecisionIds: readonly string[];
  readonly complete: boolean;
};

function lifecycleOf(evaluation: ReviewEvaluationV1): ReviewDecisionLifecycle {
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

function needsWork(evaluation: ReviewEvaluationV1 | undefined): boolean {
  if (!evaluation) return true;
  const life = lifecycleOf(evaluation);
  return life === 'PENDING' || life === 'SEARCHING' || life === 'FAILED_RETRYABLE'
    || (evaluation.evidence.source === 'heuristic' && !isForcedDecision(evaluation.candidates)
      && life !== 'FORCED' && life !== 'SCORED');
}

/**
 * Durable-friendly completion pass: escalate every non-forced decision until
 * SCORED/FORCED or FAILED_RETRYABLE/FAILED_FATAL. Does NOT convert budget
 * exhaustion into UNAVAILABLE. `complete` is true only when every decision
 * is SCORED or FORCED.
 */
export function completeReviewEvaluations(
  input: CompleteReviewEvaluationsInput,
): CompleteReviewEvaluationsResult {
  const maxTier = input.maxTier ?? 4;
  const startTier = input.startTier ?? 2;
  const liveErrors = input.liveErrorsByDecisionId ?? new Map<string, unknown>();

  const merged = new Map(input.liveResultsByDecisionId);
  const reevaluatedDecisionIds: string[] = [];
  const retryableDecisionIds: string[] = [];
  const fatalDecisionIds: string[] = [];
  let promotedToSearchOrExact = 0;
  const reasonCounts: Record<string, number> = {};
  const lifecycleCounts: Record<ReviewDecisionLifecycle, number> = {
    PENDING: 0,
    SEARCHING: 0,
    SCORED: 0,
    FORCED: 0,
    FAILED_RETRYABLE: 0,
    FAILED_FATAL: 0,
  };

  const bump = (key: string) => {
    reasonCounts[key] = (reasonCounts[key] ?? 0) + 1;
  };

  for (const snapshot of input.snapshots) {
    const decisionId = snapshot.identifiers.decisionId;
    const live = merged.get(decisionId);
    const hadError = liveErrors.has(decisionId);

    // Cannot escalate without a real V2 public surface (tests / corrupt capture).
    const canEscalate = Array.isArray(snapshot.preAction?.actorHand)
      && typeof snapshot.preAction?.opponentTileCount === 'number';
    if (!canEscalate) {
      // Stub / partial snapshot — do not invent FAILED_RETRYABLE; the full
      // results map is annotated in the post-pass below.
      continue;
    }

    if (!live) {
      if (hadError) {
        lifecycleCounts.FAILED_RETRYABLE += 1;
        retryableDecisionIds.push(decisionId);
        bump('evaluation-error');
      } else {
        lifecycleCounts.FAILED_RETRYABLE += 1;
        retryableDecisionIds.push(decisionId);
        bump('missing-snapshot');
      }
      continue;
    }

    if (isForcedDecision(live.candidates)) {
      const annotated = {
        ...live,
        evaluationProvenance: {
          phase: live.evaluationProvenance?.phase ?? 'completion',
          lifecycle: 'FORCED' as const,
          positionHash: live.evaluationProvenance?.positionHash,
        },
      };
      merged.set(decisionId, annotated);
      lifecycleCounts.FORCED += 1;
      bump('forced');
      continue;
    }
    if (live.evidence.source === 'exact' || live.evidence.source === 'search') {
      const annotated = {
        ...live,
        evaluationProvenance: {
          phase: live.evaluationProvenance?.phase ?? 'completion',
          lifecycle: 'SCORED' as const,
          positionHash: live.evaluationProvenance?.positionHash,
          escalationTier: live.evaluationProvenance?.escalationTier,
        },
      };
      merged.set(decisionId, annotated);
      lifecycleCounts.SCORED += 1;
      bump('scored');
      continue;
    }

    if (!needsWork(live) && !hadError) {
      const life = lifecycleOf(live);
      lifecycleCounts[life] += 1;
      bump(life.toLowerCase());
      continue;
    }

    reevaluatedDecisionIds.push(decisionId);
    const result = adaptiveEvaluateReviewPosition(snapshot, {
      startTier,
      maxTier,
      phase: 'completion',
    });
    merged.set(decisionId, result.evaluation);
    lifecycleCounts[result.lifecycle] += 1;
    bump(result.lifecycle.toLowerCase());
    if (result.lifecycle === 'SCORED') promotedToSearchOrExact += 1;
    if (result.lifecycle === 'FAILED_RETRYABLE') retryableDecisionIds.push(decisionId);
    if (result.lifecycle === 'FAILED_FATAL') fatalDecisionIds.push(decisionId);
  }

  // Annotate any live results not visited via snapshots (test fixtures /
  // partial maps) so lifecycle counts cover the full evaluation set.
  for (const [decisionId, evaluation] of [...merged.entries()]) {
    if (evaluation.evaluationProvenance?.lifecycle) continue;
    if (isForcedDecision(evaluation.candidates)) {
      merged.set(decisionId, {
        ...evaluation,
        evaluationProvenance: { phase: 'completion', lifecycle: 'FORCED' },
      });
      lifecycleCounts.FORCED += 1;
      bump('forced');
    } else if (evaluation.evidence.source === 'exact' || evaluation.evidence.source === 'search') {
      merged.set(decisionId, {
        ...evaluation,
        evaluationProvenance: { phase: 'completion', lifecycle: 'SCORED' },
      });
      lifecycleCounts.SCORED += 1;
      bump('scored');
    } else {
      merged.set(decisionId, {
        ...evaluation,
        evaluationProvenance: {
          phase: 'completion',
          lifecycle: 'FAILED_RETRYABLE',
          failureReason: 'missing-snapshot',
        },
      });
      lifecycleCounts.FAILED_RETRYABLE += 1;
      retryableDecisionIds.push(decisionId);
      bump('failed_retryable');
    }
  }

  // Preserve any live results for decisionIds not in snapshots (tests).
  for (const [id, evaluation] of input.liveResultsByDecisionId) {
    if (merged.has(id)) continue;
    merged.set(id, evaluation);
  }

  const complete =
    lifecycleCounts.PENDING === 0
    && lifecycleCounts.SEARCHING === 0
    && lifecycleCounts.FAILED_RETRYABLE === 0
    && lifecycleCounts.FAILED_FATAL === 0
    && (lifecycleCounts.SCORED + lifecycleCounts.FORCED) > 0;

  return {
    resultsByDecisionId: merged,
    reasonCounts,
    lifecycleCounts,
    reevaluatedDecisionIds,
    promotedToSearchOrExact,
    retryableDecisionIds,
    fatalDecisionIds,
    complete,
  };
}
