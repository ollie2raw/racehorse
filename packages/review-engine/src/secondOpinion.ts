/**
 * Second opinion: before the review states a severity, ask the long view too.
 *
 * The review's search values a position at its horizon as the current score difference, so it never sees the rest of the hand
 * (docs/review-quality-baseline-2026-11-02.md, section 5). A rollout plays each candidate out to the end of the hand against hidden
 * hands sampled consistently with what the reviewed player could know. Measured cross-validated over 595 bot decisions (section 7):
 * keeping only the verdicts the long view agrees with raises the share of error verdicts that hold up from 66% to 78% and halves the
 * false "Best" rate (12% to 6%).
 *
 *   error verdict (played is not the review's best)  CONFIRMED when the review's best beats the played move in the rollout (> 0)
 *   "Best" verdict (played is the review's best)     UNCONFIRMED when the rollout finds another move better by more than 1 point
 *
 * An unconfirmed verdict is not a claim that the review is wrong; it means two independent views disagree, so the review should not
 * state a severity (or a "Best") with full confidence. How that is presented is the caller's business; this module only measures.
 *
 * Applies only to search evidence on a position with a draw pile: exact endgames are ground truth, heuristic evaluations carry no
 * point claim, and a forced decision has no choice. Everything else returns null.
 *
 * Deterministic: sampled hands are seeded by the decision id and the Fritz continuation policy is a pure function of the state.
 * No wall-clock input and no `node:` imports.
 */
import type { FritzTier } from '@racehorse/game-core';
import type { ReviewAction, ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { rolloutGain, sampleAllocations } from './rolloutValue';

/** Hidden hands per decision. The measurement used 60 per deciding half. */
export const SECOND_OPINION_SAMPLES = 60;
/** Fewer consistent hands than this is too little evidence to second-guess the review. */
export const SECOND_OPINION_MIN_SAMPLES = 10;
/** A "Best" is unconfirmed when the rollout prefers another move by more than this many points. */
export const SECOND_OPINION_BEST_MARGIN = 1;
/** The Fritz tier both sides continue with in the rollout (the tier the measurement used). */
export const SECOND_OPINION_TIER: FritzTier = 'standard';

export type SecondOpinion = {
  readonly verdict: 'confirmed' | 'unconfirmed';
  readonly kind: 'error' | 'best';
  readonly samples: number;
  /** Rollout points: for an error, the review's best minus the played move; for "Best", the rollout's own best move minus the played move. */
  readonly rolloutMargin: number;
};

const key = (action: ReviewAction) => JSON.stringify(action);
const mean = (xs: readonly number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;

export function computeSecondOpinion(
  snapshot: ReviewPositionSnapshotV2,
  evaluation: ReviewEvaluationV1,
  options: { readonly samples?: number } = {},
): SecondOpinion | null {
  if (evaluation.evidence.source !== 'search') return null;
  if (evaluation.candidates.length < 2) return null;
  if (snapshot.preAction.boneyard.drawableCount <= 0) return null;

  const played = evaluation.played.action;
  const best = evaluation.best.action;
  const allocations = sampleAllocations(snapshot, 'second-opinion', options.samples ?? SECOND_OPINION_SAMPLES);
  if (allocations.length < SECOND_OPINION_MIN_SAMPLES) return null;

  const value = (action: ReviewAction) => mean(allocations.map((a) => rolloutGain(snapshot, a, action, SECOND_OPINION_TIER)));

  if (key(played) !== key(best)) {
    // Only two moves matter for an error verdict: is the review's best really better than what was played?
    const rolloutMargin = value(best) - value(played);
    return { verdict: rolloutMargin > 0 ? 'confirmed' : 'unconfirmed', kind: 'error', samples: allocations.length, rolloutMargin };
  }

  const playedValue = value(played);
  const rivals = evaluation.candidates.map((c) => c.action).filter((a) => key(a) !== key(played));
  const rolloutMargin = Math.max(...rivals.map(value)) - playedValue;
  return {
    verdict: rolloutMargin > SECOND_OPINION_BEST_MARGIN ? 'unconfirmed' : 'confirmed',
    kind: 'best',
    samples: allocations.length,
    rolloutMargin,
  };
}
