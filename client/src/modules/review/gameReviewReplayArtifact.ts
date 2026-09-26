import type { ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { isForcedDecision } from '@racehorse/game-core/review';
import type { GameAnalysis } from '../../analyzer/moveAnalyzer';
import {
  createReviewCoachingFactsResolver,
  type ReviewCoachingFactsBuildFn,
} from '../../analyzer/reviewCoachingFactsResolver';
import { buildReviewCoachingProse } from '../../analyzer/reviewCoachingProse';
import type { ReviewCoachingFacts, ReviewCoachingProse } from '../../analyzer/reviewCoachingFacts';
import {
  createReviewCoachingFactsStore,
  type ReviewCoachingFactsStore,
} from './reviewCoachingFactsStore';

/** Must match server `GAME_REVIEW_REPLAY_ARTIFACT_VERSION`. */
export const GAME_REVIEW_REPLAY_ARTIFACT_VERSION = 1 as const;

export type GameReviewReplayArtifactV1 = {
  readonly artifactVersion: typeof GAME_REVIEW_REPLAY_ARTIFACT_VERSION;
  readonly analysis: GameAnalysis;
  readonly decisionIds: readonly { readonly moveNumber: number; readonly decisionId: string }[];
  readonly decisions: readonly {
    readonly decisionId: string;
    readonly coachingFacts: ReviewCoachingFacts;
    readonly coachingProse: ReviewCoachingProse;
  }[];
};

export type BuildGameReviewReplayArtifactInput = {
  readonly analysis: GameAnalysis;
  readonly evaluationsByDecisionId: ReadonlyMap<string, ReviewEvaluationV1>;
  readonly decisionIdByMoveNumber: ReadonlyMap<number, string>;
  readonly snapshotsByDecisionId?: ReadonlyMap<string, ReviewPositionSnapshotV2>;
  /**
   * Review-scoped store from PR #289. When omitted, a temporary store is used
   * for this build only (still one construction per decision).
   */
  readonly coachingFactsStore?: ReviewCoachingFactsStore<ReviewCoachingFacts> | null;
  readonly buildFacts?: ReviewCoachingFactsBuildFn;
  readonly enablePositionalExplanations?: boolean;
  /** Injected for zero-recompute / measurement tests. */
  readonly buildProse?: (facts: ReviewCoachingFacts) => ReviewCoachingProse;
  /** Enforce exact expected-ID coverage before writing an authoritative final artifact. */
  readonly expectedDecisionIds?: readonly string[];
  readonly assertAuthoritativeComplete?: boolean;
};

/**
 * Builds the F1e-5 Path A replay artifact from the live review runtime.
 *
 * Facts come through `createReviewCoachingFactsResolver` against the review
 * store — never a second independent Fritz construction path inside the
 * persistence writer. Rendered prose is snapshotted (no renderer-version
 * dispatcher exists in-repo).
 *
 * Actor pre-move hand context is already inside `analysis.analyzedMoves[]`
 * (`handBefore`, `validMoves`, `playedTile` / `action`). Artifact v1 does not
 * duplicate those fields — historical GameReviewer reuses the same
 * `buildReviewDecisionHandContext` path as live review.
 */
export function buildGameReviewReplayArtifact(
  input: BuildGameReviewReplayArtifactInput,
): GameReviewReplayArtifactV1 {
  if (input.assertAuthoritativeComplete) {
    const expected = input.expectedDecisionIds ?? [];
    const expectedSet = new Set(expected);
    if (expected.length === 0 || expectedSet.size !== expected.length) {
      throw new Error('Final review artifact requires a non-empty unique expected decision set');
    }
    if (input.evaluationsByDecisionId.size !== expectedSet.size
      || [...input.evaluationsByDecisionId.keys()].some((id) => !expectedSet.has(id))) {
      throw new Error('Final review artifact evaluation coverage does not match expected decision IDs');
    }
    for (const [decisionId, evaluation] of input.evaluationsByDecisionId) {
      const lifecycle = evaluation.evaluationProvenance?.lifecycle;
      const forced = isForcedDecision(evaluation.candidates);
      if ((forced && lifecycle !== 'FORCED')
        || (!forced && (lifecycle !== 'SCORED' || !['exact', 'search'].includes(evaluation.evidence.source)))) {
        throw new Error(`Final review artifact contains unresolved decision ${decisionId}`);
      }
    }
  }
  const store =
    input.coachingFactsStore ??
    createReviewCoachingFactsStore<ReviewCoachingFacts>(`persist:${input.analysis.analyzedAt}`);
  const eligibleDecisionIds = [...input.evaluationsByDecisionId.keys()];
  const resolver = createReviewCoachingFactsResolver({
    store,
    getEvaluation: (decisionId) => input.evaluationsByDecisionId.get(decisionId),
    getSnapshot: (decisionId) => input.snapshotsByDecisionId?.get(decisionId),
    eligibleDecisionIds,
    buildFacts: input.buildFacts,
    enablePositionalExplanations: input.enablePositionalExplanations,
  });
  const buildProse = input.buildProse
    ?? ((facts: ReviewCoachingFacts) => buildReviewCoachingProse(facts, input.enablePositionalExplanations === true));

  const decisionIds = [...input.decisionIdByMoveNumber.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([moveNumber, decisionId]) => ({ moveNumber, decisionId }));

  const decisions: GameReviewReplayArtifactV1['decisions'][number][] = [];
  for (const decisionId of eligibleDecisionIds) {
    const facts = resolver.getFacts(decisionId);
    if (!facts) continue;
    decisions.push({
      decisionId,
      coachingFacts: facts,
      coachingProse: buildProse(facts),
    });
  }

  return {
    artifactVersion: GAME_REVIEW_REPLAY_ARTIFACT_VERSION,
    analysis: input.analysis,
    decisionIds,
    decisions,
  };
}
