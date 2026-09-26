import { tileEquals } from '@racehorse/game-core/types';
import type {
  ReviewAction,
  ReviewEvaluationEvidence,
  ReviewEvaluationV1,
  ReviewPositionSnapshotV2,
  ReviewPrincipalVariationStep,
} from '@racehorse/game-core/review';
import { computePositionalFeatures, POSITIONAL_FEATURE_NAMES, type PositionalFeatureName } from '@racehorse/review-engine';
import type { FritzSecondOpinion } from './reviewFritzSecondOpinion';
import type { LossBandLabel } from './gameAccuracyModel';
import { REVIEW_POSITIONAL_EXPLANATIONS_ENABLED } from '../appRouteTypes';

/** Re-export ship gate for analyzer/devtools callers. */
export { REVIEW_POSITIONAL_EXPLANATIONS_ENABLED };

export type ReviewCoachingMissKind =
  | 'better_tile'
  | 'same_tile_wrong_end'
  | 'missed_score'
  | 'reply_risk'
  | 'forced'
  | 'pass_or_draw'
  | 'correct'
  | 'unknown';

export type ReviewCoachingProse = {
  readonly headline: string;
  readonly detail: string;
  readonly takeaway: string;
};

/** New review records always use the Review Engine. `fritz` is retained only
 * to decode historical artifacts; it is never an active post-game authority. */
export type ReviewCoachingReferenceSource = 'oracle' | 'fritz';

export type ReviewAgreementPlayedMatch = 'oracle' | 'fritz' | 'both' | 'neither';

/** Legacy artifact metadata. New review records set this to not-computed and
 * never use it to choose a best move, classification, or user-facing copy. */
export type ReviewAgreement = {
  readonly oracleVsFritz: 'agree' | 'disagree' | 'not-computed';
  readonly playedMatch: ReviewAgreementPlayedMatch;
  readonly contested: boolean;
};

/**
 * F1c / D2 (2026-09-21) contested-severity policy.
 *
 * Corpus: 3,447 oracle/Fritz disagreements (39 exact / 3,401 rollout / 7
 * infeasible). Sign: oracle − Fritz. Continuation policies were
 * `uniform-legal` and `immediate-score` (game-core only; neither Fritz- nor
 * oracle-derived).
 *
 * | tier      | D2 result        | mean gap | 95% CI              |
 * | exact     | indistinguishable| +0.907   | [−0.816, +2.817]    |
 * | search    | oracle wins      | +0.553   | [+0.390, +0.772]    |
 * | heuristic | Fritz wins       | −0.590   | [−0.859, −0.355]    |
 *
 * Locked reference choice already matched both winners (search → oracle,
 * heuristic → Fritz). Exact remains per-decision ground truth. The D2
 * indistinguishable branch (automatic Inaccuracy severity cap) did **not**
 * fire for search or heuristic, so disagreement stays reportable as
 * `agreement.contested` without suppressing Mistake/Blunder from the
 * validated reference classification.
 *
 * `severityCap: null` means no disagreement-based cap. A future study that
 * lands the indistinguishable branch for a tier would set a concrete cap
 * here rather than resurrecting silent provisional constants.
 */
export type ContestedSeverityTierPolicy = {
  readonly severityCap: LossBandLabel | null;
};

export const F1C_D2_CONTESTED_SEVERITY_POLICY: Readonly<
  Record<ReviewEvaluationEvidence['source'], ContestedSeverityTierPolicy>
> = {
  exact: { severityCap: null },
  search: { severityCap: null },
  heuristic: { severityCap: null },
};

const LOSS_BAND_ORDER: readonly LossBandLabel[] = ['Best', 'Inaccuracy', 'Mistake', 'Blunder'];

/**
 * Resolves loss-band severity given agreement + evidence tier.
 *
 * Contested (`agreement.contested`) is factual disagreement metadata and is
 * intentionally independent of this function — callers must not infer
 * contested from the returned label, and must not treat contested as an
 * automatic Inaccuracy after F1c for search/heuristic.
 *
 * Exact never applied a contested severity cap (exact ground truth). After
 * F1c, search/heuristic also have `severityCap: null`, so Mistake/Blunder
 * from the validated reference survive engine disagreement.
 *
 * Name retained for call-site compatibility with the pre-F1c helper; behavior
 * is now the D2-resolved identity (or a future explicit cap if a tier policy
 * is updated).
 */
export function capSeverityForContestedDecision(
  label: LossBandLabel,
  agreement: ReviewAgreement,
  evidenceSource: ReviewEvaluationEvidence['source'],
  enablePositionalExplanations: boolean = false,
): LossBandLabel {
  if (!enablePositionalExplanations || !agreement.contested) return label;
  const cap = F1C_D2_CONTESTED_SEVERITY_POLICY[evidenceSource].severityCap;
  if (cap === null) return label;
  return LOSS_BAND_ORDER.indexOf(label) > LOSS_BAND_ORDER.indexOf(cap) ? cap : label;
}

const MIN_SUPPORTED_FEATURE_DELTA = 0.5;

export type ReviewFeatureDelta = {
  readonly feature: PositionalFeatureName;
  readonly playedValue: number;
  readonly referenceValue: number;
  /** referenceValue - playedValue, signed (not yet polarity-adjusted for "better/worse"). */
  readonly delta: number;
};

function buildFeatureDeltas(
  played: Record<PositionalFeatureName, number>,
  reference: Record<PositionalFeatureName, number>,
): readonly ReviewFeatureDelta[] {
  return POSITIONAL_FEATURE_NAMES.map((feature) => ({
    feature,
    playedValue: played[feature],
    referenceValue: reference[feature],
    delta: reference[feature] - played[feature],
  }))
    .filter((d) => Math.abs(d.delta) >= MIN_SUPPORTED_FEATURE_DELTA)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

/**
 * Phase D0 (game-review-oracle-upgrade-2026-09-13.md): the single structured
 * facts object every coaching copy path should eventually read from, in
 * place of the three competing paths the doc's Phase D section names
 * (`buildExplanation`, `positiveNote`, `buildReviewSidebarCopy`).
 *
 * feat/review-positional-features extends this with the reference-move
 * policy (`referenceSource`/`fritzMove`), the `agreement` field, and
 * `featureDeltas` (ranked positional-feature deltas between the played and
 * reference moves) -- all optional/absent when `buildReviewCoachingFacts`
 * is called without a `ReviewPositionSnapshotV2` (see that function), so
 * every pre-existing caller and test keeps its original behavior exactly.
 */
export type ReviewCoachingFacts = {
  readonly played: { readonly action: ReviewAction; readonly immediatePoints: number };
  readonly best: { readonly action: ReviewAction; readonly immediatePoints: number };
  /** Present only when positional explanations are explicitly enabled. */
  readonly referenceSource?: ReviewCoachingReferenceSource;
  readonly missKind: ReviewCoachingMissKind;
  readonly deltas: {
    readonly immediatePoints: number;
    /**
     * Oracle-best minus played expected value. This is the review-loss value
     * used by accuracy/classification, not necessarily the displayed
     * coaching reference at heuristic tier.
     */
    readonly expectedPointDifferential: number;
    /**
     * Displayed-reference minus played expected value on the evaluation's
     * net, immediate-score-inclusive scale. Absent when the displayed
     * reference has no calibrated comparable candidate value (Fritz at
     * heuristic tier); prose must not infer it from oracle loss or raw rank.
     */
    readonly referenceExpectedPointDifferential?: number;
    readonly winProbability?: number;
  };
  readonly evidence: ReviewEvaluationEvidence;
  readonly principalVariation: readonly ReviewPrincipalVariationStep[];
  /** Present only when positional explanations are explicitly enabled. */
  readonly agreement?: ReviewAgreement;
  /** @deprecated Historical artifact field. New reviews never populate it. */
  readonly fritzMove?: FritzSecondOpinion;
  /**
   * The oracle's own `best` candidate (`evaluation.best`), present
   * alongside `fritzMove` whenever the latter is (i.e. non-exact tier with
   * a snapshot supplied) -- kept as its own field so a contested-tier
   * ('fritz' `referenceSource`) prose/UI path can still name "what the
   * oracle would have played" without it being confused for `best` itself.
   * At exact tier, or when no snapshot was supplied, this is absent (same
   * value as `best` in the oracle-referenced cases, so nothing new to add).
   */
  readonly oracleMove?: { readonly action: ReviewAction; readonly immediatePoints: number };
  /** Ranked (largest |delta| first) positional-feature deltas, played vs. `best`. Present only when a snapshot was supplied. */
  readonly featureDeltas?: readonly ReviewFeatureDelta[];
  readonly prose?: ReviewCoachingProse;
};

function isPlay(action: ReviewAction): boolean {
  return action.kind === 'play';
}

function actionsEqual(a: ReviewAction, b: ReviewAction): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'play' && b.kind === 'play') {
    return tileEquals(a.tile, b.tile) && a.position === b.position;
  }
  return true;
}

/**
 * Provisional split between missed_score/reply_risk/better_tile for a
 * different-tile miss on the precise (exact/search) tier, using the share
 * of the total expected-value loss that shows up as this turn's own
 * immediate-points gap. Not yet calibrated against real data -- same
 * "flag it, don't silently finalize it" discipline as issues #226/#231.
 * >=75% of the loss showing up immediately means the miss basically IS the
 * immediate score; <=25% means the loss is almost entirely downstream of
 * this move (reply risk); the ambiguous middle has no dominant signal.
 */
const MISSED_SCORE_IMMEDIATE_SHARE = 0.75;
const REPLY_RISK_IMMEDIATE_SHARE = 0.25;

function classifyDifferentTileMiss(
  playedImmediatePoints: number,
  bestImmediatePoints: number,
  totalLoss: number,
  evidence: ReviewEvaluationEvidence,
): ReviewCoachingMissKind {
  const immediateGap = bestImmediatePoints - playedImmediatePoints;
  const isPreciseTier = evidence.source === 'exact' || evidence.source === 'search';

  if (!isPreciseTier) {
    // Heuristic tier: `value.expectedPointDifferential` (and therefore
    // `loss.expectedPointDifferential`) is always 0 by design
    // (solveHeuristicOpening.ts) -- not a real calibrated number, so it
    // cannot distinguish missed_score from reply_risk here. `immediatePoints`
    // is always real and board-derived regardless of solver tier, so it's
    // the only trustworthy signal left for this tier.
    return immediateGap > 0 ? 'missed_score' : 'unknown';
  }

  if (totalLoss <= 0) {
    // `best` is defined as having value >= played's, so a genuine
    // different-tile miss should always show a positive totalLoss. Zero or
    // negative here is a data inconsistency, not a legitimate "no loss"
    // case (that would mean played WAS best, handled before this function
    // is ever called) -- fail loud rather than guess a shape from it.
    return 'unknown';
  }

  const explainedByImmediate = Math.min(Math.max(immediateGap / totalLoss, 0), 1);
  if (explainedByImmediate >= MISSED_SCORE_IMMEDIATE_SHARE) return 'missed_score';
  if (explainedByImmediate <= REPLY_RISK_IMMEDIATE_SHARE) return 'reply_risk';
  return 'better_tile';
}

/**
 * Takes `played`/`best` explicitly (rather than reading `evaluation.best`
 * directly) so the heuristic-tier reference-move policy
 * (`buildReviewCoachingFacts` below) can pass Fritz's real move here
 * instead of `evaluateReviewPosition`'s own ported-heuristic `best`
 * candidate, without this function needing to know why.
 */
function classifyMissKind(
  played: { readonly action: ReviewAction; readonly immediatePoints: number },
  best: { readonly action: ReviewAction; readonly immediatePoints: number },
  evidence: ReviewEvaluationEvidence,
  expectedPointDifferentialLoss: number,
  distinctChoiceCount: number,
): ReviewCoachingMissKind {
  if (distinctChoiceCount === 1) return 'forced';


  if (actionsEqual(played.action, best.action)) {
    // Played the actual best move, and it wasn't forced (multiple distinct
    // choices existed) -- a correct pick, not a miss of any kind.
    return 'correct';
  }

  const playedIsPlay = isPlay(played.action);
  const bestIsPlay = isPlay(best.action);

  if (playedIsPlay !== bestIsPlay) return 'pass_or_draw';
  if (!playedIsPlay && !bestIsPlay) return 'pass_or_draw'; // e.g. played pass, best draw (or vice versa)

  // Both are 'play' actions from here on, and (per the actionsEqual check
  // above) not identical.
  const playedAction = played.action as Extract<ReviewAction, { kind: 'play' }>;
  const bestAction = best.action as Extract<ReviewAction, { kind: 'play' }>;

  if (tileEquals(playedAction.tile, bestAction.tile)) {
    // Same tile, different position/branch -- first-class per the doc.
    // Never phrase this as a tile-choice miss downstream: `played.action`
    // and `best.action` both carry the SAME tile here, so nothing in this
    // object's shape implies the tile itself was wrong.
    return 'same_tile_wrong_end';
  }

  return classifyDifferentTileMiss(played.immediatePoints, best.immediatePoints, expectedPointDifferentialLoss, evidence);
}

export function resolveAgreement(
  playedAction: ReviewAction,
  oracleBestAction: ReviewAction,
  fritzMove: FritzSecondOpinion | null,
): ReviewAgreement {
  if (!fritzMove) {
    return {
      oracleVsFritz: 'not-computed',
      playedMatch: actionsEqual(playedAction, oracleBestAction) ? 'oracle' : 'neither',
      contested: false,
    };
  }
  const matchesOracle = actionsEqual(playedAction, oracleBestAction);
  const matchesFritz = actionsEqual(playedAction, fritzMove.action);
  const playedMatch: ReviewAgreementPlayedMatch =
    matchesOracle && matchesFritz ? 'both' : matchesOracle ? 'oracle' : matchesFritz ? 'fritz' : 'neither';
  const oracleVsFritzAgree = actionsEqual(oracleBestAction, fritzMove.action);
  return {
    oracleVsFritz: oracleVsFritzAgree ? 'agree' : 'disagree',
    playedMatch,
    contested: !oracleVsFritzAgree,
  };
}

/**
 * Builds coaching facts from the canonical Review Engine evaluation.
 * `snapshot` is optional and supplies only the position data needed for
 * positional explanations. Every evidence tier uses `evaluation.best`;
 * Fritz is not computed here and legacy competing-reference metadata is
 * omitted.
 */
export function buildReviewCoachingFacts(
  evaluation: ReviewEvaluationV1,
  snapshot?: ReviewPositionSnapshotV2,
  enablePositionalExplanations: boolean = false,
): ReviewCoachingFacts {
  const { played, best: oracleBest, evidence, candidates, loss } = evaluation;
  if (candidates.length === 0) {
    throw new Error(
      'buildReviewCoachingFacts: evaluation has no candidates -- evaluateReviewPosition guarantees ' +
        'at least the played action is always represented.',
    );
  }

  // The default path is deliberately byte-for-byte the pre-F2 D0 facts
  // shape. In particular it must not pay for Fritz Master or add agreement,
  // reference, or feature fields until the feature is explicitly enabled.
  if (!enablePositionalExplanations) {
    const distinctChoiceCount = candidates.length;
    const resolvedBest = { action: oracleBest.action, immediatePoints: oracleBest.immediatePoints };
    return {
      played: { action: played.action, immediatePoints: played.immediatePoints },
      best: resolvedBest,
      missKind: classifyMissKind(
        { action: played.action, immediatePoints: played.immediatePoints },
        resolvedBest,
        evidence,
        loss.expectedPointDifferential,
        distinctChoiceCount,
      ),
      deltas: {
        immediatePoints: oracleBest.immediatePoints - played.immediatePoints,
        expectedPointDifferential: loss.expectedPointDifferential,
        ...(['exact', 'search'].includes(evidence.source)
          ? { referenceExpectedPointDifferential: loss.expectedPointDifferential }
          : {}),
        ...(loss.winProbability !== null ? { winProbability: loss.winProbability } : {}),
      },
      evidence,
      principalVariation: oracleBest.principalVariation,
    };
  }

  // The Review Engine evaluation is the sole post-game authority. Fritz may
  // participate internally in search, but is never a second presentation
  // reference or a competing recommendation.
  const referenceSource: ReviewCoachingReferenceSource = 'oracle';
  const resolvedBest: { readonly action: ReviewAction; readonly immediatePoints: number } = {
    action: oracleBest.action,
    immediatePoints: oracleBest.immediatePoints,
  };
  const agreement: ReviewAgreement = {
    playedMatch: actionsEqual(played.action, oracleBest.action) ? 'oracle' : 'neither',
    oracleVsFritz: 'not-computed',
    contested: false,
  };

  const distinctChoiceCount = candidates.length;
  const missKind = classifyMissKind(
    { action: played.action, immediatePoints: played.immediatePoints },
    resolvedBest,
    evidence,
    loss.expectedPointDifferential,
    distinctChoiceCount,
  );

  const deltas: ReviewCoachingFacts['deltas'] = {
    immediatePoints: resolvedBest.immediatePoints - played.immediatePoints,
    expectedPointDifferential: loss.expectedPointDifferential,
    ...(['exact', 'search'].includes(evidence.source)
      ? { referenceExpectedPointDifferential: loss.expectedPointDifferential }
      : {}),
    ...(loss.winProbability !== null ? { winProbability: loss.winProbability } : {}),
  };

  const featureDeltas = snapshot
    ? buildFeatureDeltas(
        computePositionalFeatures(snapshot, played.action),
        computePositionalFeatures(snapshot, resolvedBest.action),
      )
    : undefined;

  return {
    played: { action: played.action, immediatePoints: played.immediatePoints },
    best: resolvedBest,
    referenceSource,
    missKind,
    deltas,
    evidence,
    // Sourced from the oracle's own best candidate regardless of
    // `referenceSource` -- `fritzMove` (chooseBotMove) carries no
    // principal-variation line to substitute.
    principalVariation: oracleBest.principalVariation,
    agreement,
    ...(featureDeltas ? { featureDeltas } : {}),
  };
}
