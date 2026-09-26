import type { ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import type { ReviewCoachingFactsStore } from '../modules/review/reviewCoachingFactsStore';
import {
  buildReviewCoachingFacts,
  type ReviewCoachingFacts,
} from './reviewCoachingFacts';

/**
 * Intra-review coaching-facts consistency owner.
 *
 * Guarantees intra-review consistency. Facts are derived from the canonical
 * Review Engine evaluation; this resolver does not run Fritz. Historical
 * artifacts with a competing legacy reference are normalized at presentation.
 *
 * Lifetime: one review instance (caller supplies a fresh store / identity).
 * Key: stable decision ID within that instance.
 */
export type ReviewCoachingFactsBuildFn = (
  evaluation: ReviewEvaluationV1,
  snapshot?: ReviewPositionSnapshotV2,
  enablePositionalExplanations?: boolean,
) => ReviewCoachingFacts;

export type ReviewCoachingFactsInvocationStats = {
  readonly eligibleDecisionCount: number;
  readonly uniqueDecisionsRequested: number;
  readonly factRequests: number;
  /** Times `buildFacts` ran. */
  readonly constructions: number;
  readonly duplicateFactRequests: number;
  /** Extra constructions beyond one per unique requested decision. Target: 0. */
  readonly duplicateConstructions: number;
};

export type ReviewCoachingFactsResolver = {
  readonly reviewIdentity: string;
  getFacts(decisionId: string): ReviewCoachingFacts | null;
  getInvocationStats(): ReviewCoachingFactsInvocationStats;
};

export type CreateReviewCoachingFactsResolverArgs = {
  readonly store: ReviewCoachingFactsStore<ReviewCoachingFacts>;
  readonly getEvaluation: (decisionId: string) => ReviewEvaluationV1 | undefined;
  readonly getSnapshot: (decisionId: string) => ReviewPositionSnapshotV2 | undefined;
  /** Decision IDs that belong to this review (for measurement denominators). */
  readonly eligibleDecisionIds?: readonly string[];
  readonly buildFacts?: ReviewCoachingFactsBuildFn;
  readonly enablePositionalExplanations?: boolean;
};

/**
 * Lazy memoizing resolver: first request for a decision may construct (and may
 * construct facts); every later request in this store
 * reuses the same published object.
 */
export function createReviewCoachingFactsResolver(
  args: CreateReviewCoachingFactsResolverArgs,
): ReviewCoachingFactsResolver {
  const buildFacts = args.buildFacts ?? buildReviewCoachingFacts;
  const eligible = args.eligibleDecisionIds ?? [];
  let factRequests = 0;
  let constructions = 0;
  const requested = new Set<string>();
  const constructed = new Set<string>();

  return {
    reviewIdentity: args.store.reviewIdentity,
    getFacts(decisionId: string): ReviewCoachingFacts | null {
      factRequests += 1;
      requested.add(decisionId);

      const cached = args.store.byDecisionId.get(decisionId);
      if (cached !== undefined) return cached;

      const evaluation = args.getEvaluation(decisionId);
      if (!evaluation) return null;

      const snapshot = args.getSnapshot(decisionId);
      const facts =
        args.enablePositionalExplanations === undefined
          ? buildFacts(evaluation, snapshot)
          : buildFacts(evaluation, snapshot, args.enablePositionalExplanations);

      // Publish once; never mutate or replace afterward.
      args.store.byDecisionId.set(decisionId, facts);
      constructions += 1;
      constructed.add(decisionId);
      return facts;
    },
    getInvocationStats(): ReviewCoachingFactsInvocationStats {
      const uniqueDecisionsRequested = requested.size;
      return {
        eligibleDecisionCount: eligible.length,
        uniqueDecisionsRequested,
        factRequests,
        constructions,
        duplicateFactRequests: Math.max(0, factRequests - uniqueDecisionsRequested),
        duplicateConstructions: Math.max(0, constructions - constructed.size),
      };
    },
  };
}

/**
 * Dev/test-only measurement: request facts for each id twice and report
 * whether construction ran more than once per decision.
 */
export function measureReviewCoachingFactsInvocations(
  resolver: ReviewCoachingFactsResolver,
  decisionIds: readonly string[],
): ReviewCoachingFactsInvocationStats {
  for (const decisionId of decisionIds) {
    resolver.getFacts(decisionId);
  }
  for (const decisionId of decisionIds) {
    resolver.getFacts(decisionId);
  }
  return resolver.getInvocationStats();
}
