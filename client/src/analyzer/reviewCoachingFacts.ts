import { tileEquals } from '@racehorse/game-core/types';
import type {
  ReviewAction,
  ReviewEvaluationEvidence,
  ReviewEvaluationV1,
  ReviewPositionSnapshotV2,
  ReviewPrincipalVariationStep,
} from '@racehorse/game-core/review';
import { computePositionalFeatures, POSITIONAL_FEATURE_NAMES, type PositionalFeatureName } from '@racehorse/review-engine';
import { dedupeCandidatesByTile } from './classifyHeuristicResult';
import { computeFritzReferenceMove, type FritzSecondOpinion } from './reviewFritzSecondOpinion';
import type { LossBandLabel } from './gameAccuracyModel';

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

/**
 * REFERENCE-MOVE POLICY (feat/review-positional-features): which move
 * `ReviewCoachingFacts.best` actually is, tier-dependent:
 *  - 'oracle': `evaluateReviewPosition`'s own `best` candidate -- exact
 *    tier's authoritative answer, or search tier's primary reference.
 *  - 'fritz': the real `chooseBotMove('master')` policy result (see
 *    `reviewFritzSecondOpinion.ts`) -- heuristic tier's reference, per the
 *    build brief ("Fritz Master's move IS the reference ... labeled as
 *    'Fritz's read'"), never `solveHeuristicOpening`'s own ported-heuristic
 *    candidate (that is `evaluation.best`, exposed here as the `oracleBest`
 *    half of `agreement`'s comparison, never as the taught reference).
 */
export type ReviewCoachingReferenceSource = 'oracle' | 'fritz';

export type ReviewAgreementPlayedMatch = 'oracle' | 'fritz' | 'both' | 'neither';

/**
 * Per-decision agreement signal (build brief item: "Add a per-decision
 * `agreement` field capturing: oracle-vs-Fritz (agree/disagree) and whether
 * the actually-played move matched the oracle, Fritz, both, or neither.").
 *  - `oracleVsFritz`: 'not-computed' at exact tier (Fritz is never queried
 *    there -- the oracle already settles it, per policy) or when no
 *    `ReviewPositionSnapshotV2` was supplied to `buildReviewCoachingFacts`
 *    (legacy call sites -- see that function's doc comment).
 *  - `contested`: true only when `oracleVsFritz === 'disagree'`, at
 *    search or heuristic tier. Always false at exact tier -- "the exact
 *    tier settles it", per the build brief -- even if a hypothetical future
 *    exact-tier Fritz computation existed and disagreed.
 */
export type ReviewAgreement = {
  readonly oracleVsFritz: 'agree' | 'disagree' | 'not-computed';
  readonly playedMatch: ReviewAgreementPlayedMatch;
  readonly contested: boolean;
};

/**
 * PROVISIONAL -- replace with Track D2 disagreement-adjudication numbers
 * when available (per the build brief: a parallel track is producing real
 * per-tier win-rate/disagreement data; these are named placeholders, not a
 * calibrated result). `git log --all --oneline | grep -i
 * "track-d\|oracle-strength\|disagreement"` found no merged Track D2 work
 * as of this PR -- these constants ship as an explicit, labeled stand-in so
 * a contested search/heuristic decision can never read as a confident
 * Blunder/Mistake off an unresolved engine disagreement, without
 * pretending a specific cap threshold has been measured.
 */
export const CONTESTED_SEVERITY_CAP_SEARCH: LossBandLabel = 'Inaccuracy';
export const CONTESTED_SEVERITY_CAP_HEURISTIC: LossBandLabel = 'Inaccuracy';

const LOSS_BAND_ORDER: readonly LossBandLabel[] = ['Best', 'Inaccuracy', 'Mistake', 'Blunder'];

/**
 * Caps a computed loss-band label when the decision is contested (oracle
 * and Fritz disagree at search/heuristic tier) -- per the build brief:
 * "the decision's classification is 'contested' and its severity must be
 * capped below Blunder/Mistake -- UNLESS the exact tier settles it". Exact
 * tier is never capped, matched here by checking `evidenceSource` directly
 * rather than trusting `agreement.contested` alone (which this module
 * already forces to `false` at exact tier -- this is a second, explicit
 * guard against a future caller passing a mismatched pair).
 */
export function capSeverityForContestedDecision(
  label: LossBandLabel,
  agreement: ReviewAgreement,
  evidenceSource: ReviewEvaluationEvidence['source'],
): LossBandLabel {
  if (evidenceSource === 'exact' || !agreement.contested) return label;
  const cap = evidenceSource === 'search' ? CONTESTED_SEVERITY_CAP_SEARCH : CONTESTED_SEVERITY_CAP_HEURISTIC;
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
  readonly referenceSource: ReviewCoachingReferenceSource;
  readonly missKind: ReviewCoachingMissKind;
  readonly deltas: {
    readonly immediatePoints: number;
    readonly expectedPointDifferential: number;
    readonly winProbability?: number;
  };
  readonly evidence: ReviewEvaluationEvidence;
  readonly principalVariation: readonly ReviewPrincipalVariationStep[];
  readonly agreement: ReviewAgreement;
  /** Fritz's real chooseBotMove('master') result, present only when a snapshot was supplied at search/heuristic tier. */
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

function resolveAgreement(
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
 * Builds the D0 facts object from a resolved `ReviewEvaluationV1`, extended
 * (feat/review-positional-features) with the tier-dependent reference-move
 * policy, the `agreement` field, and ranked positional `featureDeltas`.
 *
 * `snapshot` is OPTIONAL and deliberately so: computing Fritz's second
 * opinion / reference move requires the real `ReviewPositionSnapshotV2`
 * (see `reviewFritzSecondOpinion.ts`), which not every existing call site
 * has threaded through yet. Every field this function already produced
 * before this change (`played`, `best` at exact/search tier, `missKind`,
 * `deltas`, `evidence`, `principalVariation`) is completely unchanged when
 * `snapshot` is omitted -- `referenceSource` reads `'oracle'`, `agreement`
 * reads `{oracleVsFritz: 'not-computed', ...}`, and `fritzMove`/
 * `featureDeltas` are simply absent. This is what keeps every pre-existing
 * caller and test green without modification.
 *
 * Reference-move policy (build brief, exact wording):
 *  - exact tier: oracle's `best` is authoritative, full stop -- no Fritz
 *    computation is made.
 *  - search tier: oracle's `best` stays the primary teaching reference;
 *    Fritz's real move is ALWAYS additionally computed and exposed via
 *    `fritzMove` (a second opinion, never substituted for `best`).
 *  - heuristic tier: Fritz's real move IS the reference -- `best` here is
 *    `fritzMove`, not `evaluation.best` (which stays available only via
 *    the `oracleVsFritz` comparison inside `agreement` -- `solveHeuristicOpening`'s
 *    own ported-heuristic candidate is never presented as the teaching
 *    answer at this tier, per the build brief).
 */
export function buildReviewCoachingFacts(
  evaluation: ReviewEvaluationV1,
  snapshot?: ReviewPositionSnapshotV2,
): ReviewCoachingFacts {
  const { played, best: oracleBest, evidence, candidates, loss } = evaluation;
  if (candidates.length === 0) {
    throw new Error(
      'buildReviewCoachingFacts: evaluation has no candidates -- evaluateReviewPosition guarantees ' +
        'at least the played action is always represented.',
    );
  }

  const fritzMove: FritzSecondOpinion | null =
    snapshot ? computeFritzReferenceMove(snapshot) : null;

  const referenceSource: ReviewCoachingReferenceSource = evidence.source === 'heuristic' && fritzMove ? 'fritz' : 'oracle';
  const resolvedBest: { readonly action: ReviewAction; readonly immediatePoints: number } =
    referenceSource === 'fritz' && fritzMove
      ? { action: fritzMove.action, immediatePoints: fritzMove.immediatePoints }
      : { action: oracleBest.action, immediatePoints: oracleBest.immediatePoints };

  const comparison = resolveAgreement(played.action, oracleBest.action, fritzMove);
  const agreement = { ...comparison, contested: evidence.source !== 'exact' && comparison.contested };

  const distinctChoiceCount = dedupeCandidatesByTile(candidates).length;
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
    ...(fritzMove ? { fritzMove, oracleMove: { action: oracleBest.action, immediatePoints: oracleBest.immediatePoints } } : {}),
    ...(featureDeltas ? { featureDeltas } : {}),
  };
}
