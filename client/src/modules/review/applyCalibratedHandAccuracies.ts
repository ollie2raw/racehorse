import { computeGameAccuracyModel } from '@racehorse/review-engine';
import { isForcedDecision } from '@racehorse/game-core/review';
import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import type { GameAnalysis } from '../../analyzer/moveAnalyzer';
import type { HandAnalysis } from '../../analyzer/analysisTypes';

/**
 * Canonical hand accuracy = the same calibrated model as game "Scored
 * accuracy", restricted to that hand's evaluations. Replaces the legacy
 * mean of Fritz-ish `move.score` values that produced mismatched Hand N %
 * vs game scored accuracy (e.g. Hand 1 at 73% while six of seven moves
 * were SEARCH BEST).
 *
 * `null` means the hand has no authoritative % yet: still analyzing a
 * non-forced decision, below coverage floor, or only forced/unavailable.
 * Progressive UX: show % only when every non-forced decision in the hand
 * is SCORED.
 */
export function calibratedHandAccuracy(
  evaluations: readonly ReviewEvaluationV1[],
): number | null {
  if (evaluations.length === 0) return null;
  return computeGameAccuracyModel(evaluations).accuracy;
}

function isScoredNonForced(evaluation: ReviewEvaluationV1): boolean {
  const lifecycle = evaluation.evaluationProvenance?.lifecycle;
  if (lifecycle === 'FORCED' || isForcedDecision(evaluation.candidates)) return false;
  if (lifecycle === 'SCORED') return true;
  const source = evaluation.evidence.source;
  return source === 'exact' || source === 'search';
}

function isForcedEvaluation(evaluation: ReviewEvaluationV1): boolean {
  const lifecycle = evaluation.evaluationProvenance?.lifecycle;
  return lifecycle === 'FORCED' || isForcedDecision(evaluation.candidates);
}

export function applyCalibratedHandAccuracies(
  analysis: GameAnalysis,
  args: {
    readonly decisionIdByMoveNumber: ReadonlyMap<number, string> | null | undefined;
    readonly resultsByDecisionId: ReadonlyMap<string, ReviewEvaluationV1>;
    /** Decisions still in-flight — hand % stays null until they resolve. */
    readonly pendingDecisionIds?: ReadonlySet<string>;
  },
): GameAnalysis {
  const { decisionIdByMoveNumber, resultsByDecisionId, pendingDecisionIds } = args;
  if (!analysis.hands || analysis.hands.length === 0) {
    return analysis;
  }

  const hands: HandAnalysis[] = analysis.hands.map((hand) => {
    const handEvals: ReviewEvaluationV1[] = [];
    let handAuthoritative = true;

    for (const move of hand.analyzedMoves) {
      const decisionId = decisionIdByMoveNumber?.get(move.moveNumber);
      if (!decisionId) {
        handAuthoritative = false;
        continue;
      }
      if (pendingDecisionIds?.has(decisionId)) {
        handAuthoritative = false;
        continue;
      }
      const evaluation = resultsByDecisionId.get(decisionId);
      if (!evaluation) {
        handAuthoritative = false;
        continue;
      }
      if (isForcedEvaluation(evaluation)) {
        continue;
      }
      if (!isScoredNonForced(evaluation)) {
        // Estimate / pending lifecycle / unavailable — not final for this hand.
        handAuthoritative = false;
        continue;
      }
      handEvals.push(evaluation);
    }

    const accuracy =
      handAuthoritative && handEvals.length > 0
        ? calibratedHandAccuracy(handEvals)
        : null;

    return {
      ...hand,
      handAccuracy: accuracy,
    };
  });

  const scoredHands = hands.filter(
    (hand): hand is HandAnalysis & { handAccuracy: number } => hand.handAccuracy != null,
  );
  const worstHand =
    scoredHands.length > 0
      ? scoredHands.reduce((worst, hand) => (hand.handAccuracy < worst.handAccuracy ? hand : worst))
      : null;

  return {
    ...analysis,
    hands,
    worstHandNumber: worstHand?.handNumber ?? null,
  };
}
