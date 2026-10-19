import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { jobAuthoritativeComplete, type ReviewCompletionJobRecord } from './durableReviewCompletionRuntime';
import { WALL_CLOCK_CEILING_DIAGNOSTIC } from './evaluateReviewPosition';
import { computeGameAccuracyModel } from './gameAccuracyModel';

/**
 * The one definition of a player's per-game move quality ("avgMoveQuality") for current games.
 *
 * It is the V2 headline accuracy -- the same number the post-game review shows -- taken ONLY from a review-completion job the
 * SERVER evaluated itself and only once that job is authoritatively complete (every decision exactly covered: FORCED, or SCORED
 * by the exact/search tiers). It is never read from a client-supplied evaluation, candidate set, score or result.
 *
 * What counts (all inherited from `computeGameAccuracyModel`, not re-invented here):
 *   - the reviewed player's own decisions only (the job's snapshots are that player's decisions);
 *   - non-forced decisions only: a forced draw, pass or only-legal play carries no choice and is excluded from numerator and
 *     denominator (the legacy analyzer averaged fixed 84/80/72 constants for these);
 *   - a draw or pass when plays were available is a real, scored decision (it is a choice among the candidates);
 *   - tied-optimal moves have zero loss and score as optimal;
 *   - accuracy = 100 * exp(-k * mean expected-point loss) over the scorable decisions, unrounded, a pure function of the SET of
 *     decisions (summed in canonical order);
 *   - NO wall-clock input: the search tiers are node/sample bounded and seeded, so a position evaluated within its budget is the
 *     same on any machine. A position whose search was cut by the wall-clock safety ceiling carries a different, speed-dependent
 *     estimate (the review still shows it, with the ceiling diagnostic), so a game with ANY such decision has no stat
 *     ('wall-clock-truncated') rather than an average that depends on how fast the server was.
 *
 * Unavailable is explicit, never fabricated: an incomplete / failed job, or a game with no graded decision, yields
 * `avgMoveQuality: null` with a reason -- not 0 and not 100.
 */
export type AuthoritativeMoveQuality =
  | {
      readonly status: 'available';
      readonly avgMoveQuality: number;
      readonly accuracyModelVersion: string;
      /** Non-forced decisions that entered the average. */
      readonly gradedDecisionCount: number;
      /** Forced decisions, excluded from the average. */
      readonly forcedDecisionCount: number;
    }
  | {
      readonly status: 'unavailable';
      readonly avgMoveQuality: null;
      readonly reason: 'review-incomplete' | 'no-graded-decisions' | 'wall-clock-truncated';
    };

const UNAVAILABLE_INCOMPLETE = { status: 'unavailable', avgMoveQuality: null, reason: 'review-incomplete' } as const;
const UNAVAILABLE_TRUNCATED = { status: 'unavailable', avgMoveQuality: null, reason: 'wall-clock-truncated' } as const;
const UNAVAILABLE_NO_DECISIONS = { status: 'unavailable', avgMoveQuality: null, reason: 'no-graded-decisions' } as const;

/**
 * Derives the stat from a server job. Recomputed from the job's evaluations (not read from the stored
 * `accuracyModelResult`), so a record that went through JSON/Postgres is judged by the same function, in a canonical order,
 * and can never disagree with itself.
 */
export function authoritativeMoveQuality(job: ReviewCompletionJobRecord): AuthoritativeMoveQuality {
  if (!jobAuthoritativeComplete(job)) return UNAVAILABLE_INCOMPLETE;

  const evaluations = job.decisions
    .map((decision) => decision.evaluation)
    .filter((evaluation): evaluation is ReviewEvaluationV1 => evaluation !== null)
    .sort((a, b) => (a.snapshotId < b.snapshotId ? -1 : a.snapshotId > b.snapshotId ? 1 : 0));

  if (evaluations.some((evaluation) => evaluation.diagnostics.includes(WALL_CLOCK_CEILING_DIAGNOSTIC))) return UNAVAILABLE_TRUNCATED;

  const model = computeGameAccuracyModel(evaluations);
  if (model.accuracy === null) return UNAVAILABLE_NO_DECISIONS;

  return {
    status: 'available',
    avgMoveQuality: model.accuracy,
    accuracyModelVersion: model.accuracyModelVersion,
    gradedDecisionCount: model.totalNonForcedMoveCount - (model.unavailableMoveCount ?? 0),
    forcedDecisionCount: evaluations.length - model.totalNonForcedMoveCount,
  };
}
