import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { jobAuthoritativeComplete, type ReviewCompletionJobRecord } from './durableReviewCompletionRuntime';
import { WALL_CLOCK_CEILING_DIAGNOSTIC } from './evaluateReviewPosition';
import { computeGameAccuracyModel } from './gameAccuracyModel';

/**
 * A player's per-game move quality, as REVIEWED: the V2 headline accuracy (the same number the post-game review shows) over the
 * decisions a review-completion job holds for that player.
 *
 * ============================== TRUST LEVEL: OWNER-ONLY ==============================
 * This value is NOT authoritative about what happened in the game, and its name does not claim otherwise. Two things are
 * server-controlled and one is not:
 *
 *   candidate set     SERVER-DERIVED   re-derived from the recorded position with the engine's own rules (the client's list is replaced)
 *   evaluation        SERVER-EVALUATED  every candidate is searched/solved on the server; client evaluations are ignored
 *   PLAYED ACTION     CLIENT-ASSERTED  the move that was actually played is part of the snapshot the client submits, and nothing
 *                                      binds the job to a game this server saw. Claiming the best move was played turns a 7.3 into 100.
 *
 * So a player can only ever misreport THEIR OWN quality, and the value is therefore returned only to the owner of the job. It
 * must not be persisted, published, ranked, rewarded or shown to another user until the played action is server-authoritative
 * (server-issued or server-attested snapshots). That rule is enforced, not just documented:
 *   - every result carries `provenance` (and `ownerOnly: true`) so the limit travels with the number;
 *   - `assertMoveQualityShareable` throws unless the played action is server-authoritative, which this module never produces;
 *   - `reviewedMoveQualityGuard.test.ts` fails if any other file starts using this module or the legacy column.
 * ====================================================================================
 *
 * What counts (inherited from `computeGameAccuracyModel`, not re-invented here):
 *   - the reviewed player's own decisions only (the job's snapshots are that player's decisions);
 *   - non-forced decisions only: a forced draw, pass or only-legal play carries no choice and is excluded from numerator and
 *     denominator (the legacy analyzer averaged fixed 84/80/72 constants for these);
 *   - a draw or pass when plays were available is a real, scored decision (it is a choice among the candidates);
 *   - tied-optimal moves have zero loss and score as optimal;
 *   - accuracy = 100 * exp(-k * mean expected-point loss) over the scorable decisions, unrounded, a pure function of the SET of
 *     decisions (summed in canonical order);
 *   - NO wall-clock input: the search tiers are node/sample bounded and seeded, so a position evaluated within its budget is the
 *     same on any machine. A position whose search was cut by the wall-clock safety ceiling carries a different, speed-dependent
 *     estimate (the review still shows it, with the ceiling diagnostic), so a game with ANY such decision has no value
 *     ('wall-clock-truncated') rather than an average that depends on how fast the server was.
 *
 * Unavailable is explicit, never fabricated: an incomplete / failed job, or a game with no graded decision, yields
 * `avgMoveQuality: null` with a reason -- not 0 and not 100.
 */

/** Where each input to the number came from. `playedAction` is the one the server does not control. */
export type MoveQualityProvenance = {
  readonly candidateSet: 'server-derived';
  readonly evaluation: 'server-evaluated';
  /** 'client-asserted' until the played action is bound to a game the server saw; never set to 'server-authoritative' here. */
  readonly playedAction: 'client-asserted' | 'server-authoritative';
};

/** What this module produces: the played action is always the client's claim. */
export const CLIENT_ASSERTED_PLAYED_ACTION: MoveQualityProvenance = {
  candidateSet: 'server-derived',
  evaluation: 'server-evaluated',
  playedAction: 'client-asserted',
};

type MoveQualityBody =
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

export type ReviewedMoveQuality = MoveQualityBody & {
  readonly provenance: MoveQualityProvenance;
  /** Always true today: returned to the job's owner only. */
  readonly ownerOnly: true;
};

/** The only shape a persistence / shared surface may accept: an available value whose played action the server vouches for. */
export type ShareableMoveQuality = Extract<MoveQualityBody, { status: 'available' }> & {
  readonly provenance: MoveQualityProvenance & { readonly playedAction: 'server-authoritative' };
};

export class MoveQualityNotShareableError extends Error {
  constructor(reason: string) {
    super(`Move quality is owner-only and cannot be persisted or shared: ${reason}`);
    this.name = 'MoveQualityNotShareableError';
  }
}

/**
 * The gate any persistence, publication, ranking, reward or cross-user path must pass first. It throws for every value this module
 * produces today (the played action is client-asserted) and for any unavailable value; it only opens once a future change makes the
 * played action server-authoritative AND records that in `provenance`.
 */
export function assertMoveQualityShareable(quality: ReviewedMoveQuality): ShareableMoveQuality {
  if (quality.status !== 'available') throw new MoveQualityNotShareableError(`it is unavailable (${quality.reason})`);
  if (quality.provenance.playedAction !== 'server-authoritative') {
    throw new MoveQualityNotShareableError(
      'the played action is client-asserted (nothing binds the job to a game the server saw), so a player can raise their own value by claiming better moves',
    );
  }
  return quality as unknown as ShareableMoveQuality;
}

const UNAVAILABLE_INCOMPLETE = { status: 'unavailable', avgMoveQuality: null, reason: 'review-incomplete' } as const;
const UNAVAILABLE_TRUNCATED = { status: 'unavailable', avgMoveQuality: null, reason: 'wall-clock-truncated' } as const;
const UNAVAILABLE_NO_DECISIONS = { status: 'unavailable', avgMoveQuality: null, reason: 'no-graded-decisions' } as const;

const owned = (body: MoveQualityBody): ReviewedMoveQuality => ({ ...body, provenance: CLIENT_ASSERTED_PLAYED_ACTION, ownerOnly: true });

/**
 * Derives the owner-only reviewed move quality from a server job. Recomputed from the job's evaluations (not read from the stored
 * `accuracyModelResult`), so a record that went through JSON/Postgres is judged by the same function, in a canonical order, and
 * can never disagree with itself.
 */
export function deriveReviewedMoveQuality(job: ReviewCompletionJobRecord): ReviewedMoveQuality {
  if (!jobAuthoritativeComplete(job)) return owned(UNAVAILABLE_INCOMPLETE);

  const evaluations = job.decisions
    .map((decision) => decision.evaluation)
    .filter((evaluation): evaluation is ReviewEvaluationV1 => evaluation !== null)
    .sort((a, b) => (a.snapshotId < b.snapshotId ? -1 : a.snapshotId > b.snapshotId ? 1 : 0));

  if (evaluations.some((evaluation) => evaluation.diagnostics.includes(WALL_CLOCK_CEILING_DIAGNOSTIC))) return owned(UNAVAILABLE_TRUNCATED);

  const model = computeGameAccuracyModel(evaluations);
  if (model.accuracy === null) return owned(UNAVAILABLE_NO_DECISIONS);

  return owned({
    status: 'available',
    avgMoveQuality: model.accuracy,
    accuracyModelVersion: model.accuracyModelVersion,
    gradedDecisionCount: model.totalNonForcedMoveCount - (model.unavailableMoveCount ?? 0),
    forcedDecisionCount: evaluations.length - model.totalNonForcedMoveCount,
  });
}
