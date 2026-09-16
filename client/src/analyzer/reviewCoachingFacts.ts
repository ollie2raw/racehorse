import { tileEquals } from '@racehorse/game-core/types';
import type {
  ReviewAction,
  ReviewEvaluationEvidence,
  ReviewEvaluationV1,
  ReviewPrincipalVariationStep,
} from '@racehorse/game-core/review';
import { dedupeCandidatesByTile } from './classifyHeuristicResult';

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
 * Phase D0 (game-review-oracle-upgrade-2026-09-13.md): the single structured
 * facts object every coaching copy path should eventually read from, in
 * place of the three competing paths the doc's Phase D section names
 * (`buildExplanation`, `positiveNote`, `buildReviewSidebarCopy`). This PR
 * builds the facts only -- `prose` is deliberately absent here (D1's job);
 * every other field is produced correctly and completely from real,
 * already-computed `ReviewEvaluationV1` data, never invented.
 */
export type ReviewCoachingFacts = {
  readonly played: { readonly action: ReviewAction; readonly immediatePoints: number };
  readonly best: { readonly action: ReviewAction; readonly immediatePoints: number };
  readonly missKind: ReviewCoachingMissKind;
  readonly deltas: {
    readonly immediatePoints: number;
    readonly expectedPointDifferential: number;
    readonly winProbability?: number;
  };
  readonly evidence: ReviewEvaluationEvidence;
  readonly principalVariation: readonly ReviewPrincipalVariationStep[];
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

function classifyMissKind(
  evaluation: ReviewEvaluationV1,
  distinctChoiceCount: number,
): ReviewCoachingMissKind {
  if (distinctChoiceCount === 1) return 'forced';

  const { played, best, evidence } = evaluation;

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

  return classifyDifferentTileMiss(
    played.immediatePoints,
    best.immediatePoints,
    evaluation.loss.expectedPointDifferential,
    evidence,
  );
}

/**
 * Builds the D0 facts object from a resolved `ReviewEvaluationV1`. Every
 * field is derived from data the oracle already computed for this exact
 * decision -- nothing here is invented. `principalVariation` is sourced
 * from `best.principalVariation` as-is: today every solver path
 * (heuristic, exact, search) leaves this empty by explicit design (no
 * recorded best-line has been threaded through any of them yet -- see
 * solveHeuristicOpening.ts / solveExactEndgame.ts / solveMidgameDeterminization.ts),
 * so this will currently always come back `[]` regardless of tier. That's
 * the honest answer, not a bug in this builder: once a solver actually
 * populates it, this passthrough picks it up with no change needed here.
 */
export function buildReviewCoachingFacts(evaluation: ReviewEvaluationV1): ReviewCoachingFacts {
  const { played, best, evidence, candidates, loss } = evaluation;
  if (candidates.length === 0) {
    throw new Error(
      'buildReviewCoachingFacts: evaluation has no candidates -- evaluateReviewPosition guarantees ' +
        'at least the played action is always represented.',
    );
  }

  const distinctChoiceCount = dedupeCandidatesByTile(candidates).length;
  const missKind = classifyMissKind(evaluation, distinctChoiceCount);

  const deltas: ReviewCoachingFacts['deltas'] = {
    immediatePoints: best.immediatePoints - played.immediatePoints,
    expectedPointDifferential: loss.expectedPointDifferential,
    ...(loss.winProbability !== null ? { winProbability: loss.winProbability } : {}),
  };

  return {
    played: { action: played.action, immediatePoints: played.immediatePoints },
    best: { action: best.action, immediatePoints: best.immediatePoints },
    missKind,
    deltas,
    evidence,
    principalVariation: best.principalVariation,
  };
}
