import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { computeGameAccuracyModel, type GameAccuracyModelResult } from '@racehorse/review-engine';

const RESULT_FIELDS = [
  'status',
  'accuracyModelVersion',
  'accuracy',
  'grade',
  'heuristicMoveCount',
  'totalNonForcedMoveCount',
  'coverageFraction',
] as const satisfies readonly (keyof GameAccuracyModelResult)[];

export type AccuracyModelMismatch = {
  field: keyof GameAccuracyModelResult;
  clientAsserted: unknown;
  serverDerived: unknown;
};

export type AccuracyModelReconciliation = {
  mismatches: AccuracyModelMismatch[];
  serverDerived: GameAccuracyModelResult | null;
  reconciliationError?: unknown;
};

/**
 * Re-derives the client-asserted headline accuracy model without making the
 * persistence path authoritative. Invalid client review data is reported as
 * an observability-only reconciliation error rather than surfaced to callers.
 */
export function reconcileAccuracyModelResult(
  evaluations: readonly ReviewEvaluationV1[],
  clientAsserted: Partial<GameAccuracyModelResult> & Record<string, unknown>,
): AccuracyModelReconciliation {
  try {
    const serverDerived = computeGameAccuracyModel(evaluations);
    const mismatches = RESULT_FIELDS.flatMap((field) =>
      Object.is(clientAsserted[field], serverDerived[field])
        ? []
        : [{ field, clientAsserted: clientAsserted[field], serverDerived: serverDerived[field] }],
    );
    return { mismatches, serverDerived };
  } catch (reconciliationError) {
    return { mismatches: [], serverDerived: null, reconciliationError };
  }
}
