import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';

/**
 * What the reviewer shows while the server's authoritative job is still running: the server's verdict for a decision when it has one, otherwise the
 * device's quick first pass. The quick result is provisional (docs/postgame-review-plan.md, decision 2): it fills gaps for display only and is
 * dropped the moment the server completes, so the saved record can never contain one.
 */
export type MergedReviewResults = {
  readonly resultsByDecisionId: ReadonlyMap<string, ReviewEvaluationV1>;
  /** Decisions with neither a server verdict nor a quick one. */
  readonly pendingDecisionIds: ReadonlySet<string>;
  /** Decisions whose shown verdict is the quick pass, still waiting for the server's. */
  readonly quickDecisionIds: ReadonlySet<string>;
};

export function mergeQuickReviewResults(args: {
  /** Every decision of the game, so a decision the server has not listed yet is still pending rather than missing. */
  readonly allDecisionIds: readonly string[];
  readonly serverResults: ReadonlyMap<string, ReviewEvaluationV1>;
  readonly serverPendingIds: ReadonlySet<string>;
  readonly serverComplete: boolean;
  readonly quickResults: ReadonlyMap<string, ReviewEvaluationV1>;
}): MergedReviewResults {
  const { allDecisionIds, serverResults, serverPendingIds, serverComplete, quickResults } = args;
  // Authoritative and done: exactly the server's results, nothing quick survives.
  if (serverComplete) {
    return { resultsByDecisionId: serverResults, pendingDecisionIds: serverPendingIds, quickDecisionIds: new Set() };
  }
  // A server evaluation that is still pending (a placeholder for an unfinished decision) is not a verdict: the quick one may stand in for it.
  const resultsByDecisionId = new Map(serverResults);
  const quickDecisionIds = new Set<string>();
  for (const [decisionId, evaluation] of quickResults) {
    const serverIsFinal = serverResults.has(decisionId) && !serverPendingIds.has(decisionId);
    if (serverIsFinal) continue;
    resultsByDecisionId.set(decisionId, evaluation);
    quickDecisionIds.add(decisionId);
  }
  const pendingDecisionIds = new Set<string>();
  for (const decisionId of [...allDecisionIds, ...serverPendingIds]) {
    const hasVerdict = quickDecisionIds.has(decisionId) || (serverResults.has(decisionId) && !serverPendingIds.has(decisionId));
    if (!hasVerdict) pendingDecisionIds.add(decisionId);
  }
  return { resultsByDecisionId, pendingDecisionIds, quickDecisionIds };
}
