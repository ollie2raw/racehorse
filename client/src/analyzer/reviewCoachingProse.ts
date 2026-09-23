import type { ReviewAction } from '@racehorse/game-core/review';
import type { PositionalFeatureName } from '@racehorse/review-engine';
import {
  REVIEW_POSITIONAL_EXPLANATIONS_ENABLED,
  type ReviewCoachingFacts,
  type ReviewCoachingProse,
  type ReviewFeatureDelta,
} from './reviewCoachingFacts';

export { REVIEW_POSITIONAL_EXPLANATIONS_ENABLED } from './reviewCoachingFacts';

/**
 * Phase D1 (game-review-oracle-upgrade-2026-09-13.md): deterministic prose
 * generated ONLY from a `ReviewCoachingFacts` object -- no invented claims,
 * no numbers that don't already exist on `facts`. Deliberately a standalone
 * function, not folded into D0's `buildReviewCoachingFacts`: D0 is merged
 * and untouched by this PR, this function is independently testable against
 * hand-built `ReviewCoachingFacts` fixtures without needing a full
 * `ReviewEvaluationV1` for every case, and composing the two remains a
 * caller decision (D2's job, when GameReviewer actually renders this).
 */

function tileText(tile: { readonly low: number; readonly high: number }): string {
  return `${tile.low}-${tile.high}`;
}

function positionText(position: string): string {
  if (position === 'left') return 'the left end';
  if (position === 'right') return 'the right end';
  return 'a branch end';
}

function playAction(action: ReviewAction): Extract<ReviewAction, { kind: 'play' }> | null {
  return action.kind === 'play' ? action : null;
}

function nonPlayWord(action: ReviewAction): 'pass' | 'draw' | null {
  return action.kind === 'pass' ? 'pass' : action.kind === 'draw' ? 'draw' : null;
}

/**
 * Rounds an absolute value to one decimal, dropping a trailing ".0" so
 * whole numbers don't read as fake precision. Deliberately a local copy,
 * not imported from moveRatingCoachingCopy.ts -- that module is itself
 * flagged for retirement/absorption once D2 lands (issue #238), and this
 * PR is meant to stand fully independent of it.
 */
function formatNumber(value: number): string {
  const rounded = Math.round(Math.abs(value) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function pointsWord(value: number): string {
  return Math.round(Math.abs(value) * 10) / 10 === 1 ? 'point' : 'points';
}

/**
 * Polarity for each positional feature: when `higherIsBetter` is false, a
 * LOWER reference value is the stronger outcome for the actor. Used only to
 * decide which deltas may explain the recommended move — never exposed as
 * player-facing "feature score" copy.
 */
const FEATURE_HIGHER_IS_BETTER: Record<PositionalFeatureName, boolean> = {
  opponentOutsLeft: false,
  endControlScore: true,
  endDangerPenalty: false,
  knownMissingPipExploitationScore: true,
  handShapeOrphanCount: false,
  handShapePlayableNext: true,
  handShapeMobilityScore: true,
  scoreMarginUrgency: true,
  tileCountBoneyardPressure: false,
  doubleHubOpeningRisk: false,
  immediatePoints: true,
};

/** True when `referenceValue` is the stronger outcome for this feature, given its polarity. */
export function referenceWinsFeature(delta: ReviewFeatureDelta): boolean {
  return FEATURE_HIGHER_IS_BETTER[delta.feature] ? delta.delta > 0 : delta.delta < 0;
}

/** Small expected-value differences below this are not useful player-facing evidence. */
export const VALUE_GAP_MIN_POINTS = 0.25;

function actionLabel(action: ReviewAction): string {
  const play = playAction(action);
  if (play) return `${tileText(play.tile)} at ${positionText(play.position)}`;
  const word = nonPlayWord(action);
  return word === 'draw' ? 'drawing' : 'passing';
}

/** Compact tile/action name for headlines ("4-4", "passing"). */
function actionShort(action: ReviewAction): string {
  const play = playAction(action);
  if (play) return tileText(play.tile);
  return nonPlayWord(action) ?? 'the move';
}

/**
 * Placement contrast for same-tile / wrong-end copy. When both positions
 * collapse to the same generic "a branch end" label, prefer "this branch" /
 * "the other branch" rather than repeating identical branch wording.
 */
function placementContrast(
  played: Extract<ReviewAction, { kind: 'play' }> | null,
  best: Extract<ReviewAction, { kind: 'play' }> | null,
): { playedSpot: string; bestSpot: string; branchVsBranch: boolean } {
  const playedRaw = played ? positionText(played.position) : 'this end';
  const bestRaw = best ? positionText(best.position) : 'the other end';
  const branchVsBranch = playedRaw === 'a branch end' && bestRaw === 'a branch end';
  if (branchVsBranch) {
    return { playedSpot: 'this branch', bestSpot: 'the other branch', branchVsBranch: true };
  }
  return { playedSpot: playedRaw, bestSpot: bestRaw, branchVsBranch: false };
}

/** Review actions are structured, so this preserves tile, end, and non-play identity. */
function actionsEqual(left: ReviewAction, right: ReviewAction): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isSameTileWrongEnd(facts: ReviewCoachingFacts): boolean {
  const played = playAction(facts.played.action);
  const best = playAction(facts.best.action);
  if (!played || !best) return facts.missKind === 'same_tile_wrong_end';
  return (
    played.tile.low === best.tile.low
    && played.tile.high === best.tile.high
    && played.position !== best.position
  );
}

function isTrueDisplayedEquality(facts: ReviewCoachingFacts, includeTrueReferenceEquality: boolean): boolean {
  return includeTrueReferenceEquality
    && facts.deltas.referenceExpectedPointDifferential === 0
    && !actionsEqual(facts.played.action, facts.best.action);
}

function referenceAuthorityName(facts: ReviewCoachingFacts): string {
  return facts.referenceSource === 'fritz' ? "Fritz's read" : 'the Review Engine';
}

function countWord(value: number, singular: string, plural: string): string {
  return Math.round(Math.abs(value) * 10) / 10 === 1 ? singular : plural;
}

/** True when the played move is stronger on this feature (opposite of referenceWins). */
function playedWinsFeature(delta: ReviewFeatureDelta): boolean {
  return FEATURE_HIGHER_IS_BETTER[delta.feature] ? delta.delta < 0 : delta.delta > 0;
}

/**
 * Translate a reference-winning feature delta into board-consequence coaching.
 * Returns null when the feature cannot be stated safely without leaking
 * internal feature-unit scores (omit rather than invent or expose raw labels).
 * Literal counts are only used for features whose units are player-meaningful.
 */
function translateFeatureWhy(delta: ReviewFeatureDelta): string | null {
  const played = formatNumber(delta.playedValue);
  const reference = formatNumber(delta.referenceValue);
  switch (delta.feature) {
    case 'opponentOutsLeft':
      return `leaves your opponent only ${reference} matching ${countWord(delta.referenceValue, 'reply', 'replies')} instead of ${played}`;
    case 'handShapePlayableNext':
      return `leaves you with ${reference} follow-up ${countWord(delta.referenceValue, 'tile', 'tiles')} instead of ${played}`;
    case 'handShapeOrphanCount':
      return `leaves ${reference} orphaned ${countWord(delta.referenceValue, 'tile', 'tiles')} in hand instead of ${played}`;
    case 'immediatePoints':
      return `scores ${reference} ${pointsWord(delta.referenceValue)} immediately instead of ${played}`;
    case 'endControlScore':
      return 'keeps more control of the open ends';
    case 'endDangerPenalty':
      return 'leaves fewer easy replies for your opponent';
    case 'knownMissingPipExploitationScore':
      return 'presses a known gap in the opponent’s hand more effectively';
    case 'handShapeMobilityScore':
      return 'keeps your hand more flexible for the next play';
    case 'doubleHubOpeningRisk':
      return 'opens less double/hub risk';
    case 'scoreMarginUrgency':
    case 'tileCountBoneyardPressure':
      return null;
    default:
      return null;
  }
}

/**
 * Prefer literal outs over near-duplicate endDangerPenalty "easy replies"
 * phrasing when both favor the reference.
 */
function selectDistinctWhyDeltas(deltas: readonly ReviewFeatureDelta[]): ReviewFeatureDelta[] {
  const hasOuts = deltas.some((d) => d.feature === 'opponentOutsLeft');
  return deltas
    .filter((d) => !(hasOuts && d.feature === 'endDangerPenalty'))
    .slice(0, 2);
}

function sameTileWrongHeadline(facts: ReviewCoachingFacts): string {
  const played = playAction(facts.played.action);
  const best = playAction(facts.best.action);
  const { branchVsBranch } = placementContrast(played, best);
  return branchVsBranch ? 'Right tile, wrong branch.' : 'Right tile, wrong end.';
}

function featureHeadlineFor(delta: ReviewFeatureDelta, sameTileWrongEnd: boolean, facts: ReviewCoachingFacts): string {
  if (sameTileWrongEnd) return sameTileWrongHeadline(facts);
  switch (delta.feature) {
    case 'opponentOutsLeft':
    case 'endDangerPenalty':
      return 'You gave your opponent an easier reply.';
    case 'endControlScore':
      return 'The other placement keeps more control.';
    case 'immediatePoints':
      return 'Left points on the table.';
    default:
      return 'A different placement is stronger here.';
  }
}

function joinWhyClauses(deltas: readonly ReviewFeatureDelta[]): string | null {
  const clauses = selectDistinctWhyDeltas(deltas)
    .map(translateFeatureWhy)
    .filter((clause): clause is string => clause !== null);
  if (clauses.length === 0) return null;
  if (clauses.length === 1) return clauses[0];
  return `${clauses[0]}, and ${clauses[1]}`;
}

/** Prefer placement language when both actions share the same tile. */
function preferredValueGapSubject(facts: ReviewCoachingFacts): string {
  if (isSameTileWrongEnd(facts) || facts.missKind === 'same_tile_wrong_end') {
    const played = playAction(facts.played.action);
    const best = playAction(facts.best.action);
    const { bestSpot } = placementContrast(played, best);
    return bestSpot;
  }
  return actionShort(facts.best.action);
}

/** Explicit candidate phrase for WHY clauses after naming two lines. */
function preferredLineSubject(facts: ReviewCoachingFacts): string {
  const play = playAction(facts.best.action);
  if (!play) return "The Review Engine's line";
  if (isSameTileWrongEnd(facts)) {
    const { bestSpot, branchVsBranch } = placementContrast(playAction(facts.played.action), play);
    if (branchVsBranch || bestSpot === 'the other branch') return 'The other branch';
    if (bestSpot === 'a branch end') return 'The branch placement';
    return `The ${bestSpot.replace(/^the /, '').replace(/\s+/g, '-')} placement`;
  }
  return `The ${tileText(play.tile)} line`;
}

/** Contested preference clause that distinguishes branch-vs-branch placements. */
function contestedPreferenceClause(
  facts: ReviewCoachingFacts,
  preferred: string,
  otherEngineAction: string,
): string {
  const sameTile = isSameTileWrongEnd(facts);
  const played = playAction(facts.played.action);
  const best = playAction(facts.best.action);
  const { bestSpot, branchVsBranch } = placementContrast(played, best);
  if (facts.referenceSource === 'fritz') {
    return `Fritz prefers ${preferred}, while the Review Engine's heuristic prefers ${otherEngineAction}.`;
  }
  if (sameTile && branchVsBranch) {
    return `The Review Engine prefers ${bestSpot}, while Fritz prefers ${otherEngineAction}.`;
  }
  if (sameTile && bestSpot === 'a branch end') {
    return `The Review Engine prefers the branch placement, while Fritz prefers ${otherEngineAction}.`;
  }
  return `The Review Engine prefers ${preferred}, while Fritz prefers ${otherEngineAction}.`;
}

function buildMatchedReferenceProse(facts: ReviewCoachingFacts): ReviewCoachingProse {
  const play = playAction(facts.played.action);
  const authority = referenceAuthorityName(facts);
  if (play && facts.played.immediatePoints > 0) {
    const points = formatNumber(facts.played.immediatePoints);
    return {
      headline: 'Best move.',
      detail: `You found ${tileText(play.tile)} for ${points} ${pointsWord(facts.played.immediatePoints)}, matching ${authority}.`,
      takeaway: '',
    };
  }
  if (play) {
    return {
      headline: 'Best move.',
      detail: `${tileText(play.tile)} at ${positionText(play.position)} matches ${authority}.`,
      takeaway: '',
    };
  }
  const word = nonPlayWord(facts.played.action) ?? 'pass';
  return {
    headline: 'Best move.',
    detail: `${word === 'draw' ? 'Drawing' : 'Passing'} matches ${authority}.`,
    takeaway: '',
  };
}

function buildTrueEqualityProse(facts: ReviewCoachingFacts, contested: boolean): ReviewCoachingProse {
  const immediateGap = facts.deltas.immediatePoints;
  const referenceAction = actionLabel(facts.best.action);
  const immediateClause = immediateGap === 0
    ? ''
    : `, although ${referenceAction} scores ${formatNumber(immediateGap)} ${immediateGap > 0 ? 'more' : 'fewer'} ${pointsWord(immediateGap)} immediately`;
  if (!contested) {
    return {
      headline: `The review rates these two moves even overall${immediateClause}.`,
      detail: '',
      takeaway: '',
    };
  }
  const otherEngineAction = facts.referenceSource === 'fritz'
    ? (facts.oracleMove ? actionLabel(facts.oracleMove.action) : 'a different line')
    : (facts.fritzMove ? actionLabel(facts.fritzMove.action) : 'a different line');
  const preferred = actionLabel(facts.best.action);
  const sameTile = isSameTileWrongEnd(facts);
  const branchNote = sameTile
    ? 'prefer different placements of the same tile'
    : 'prefer different moves';
  return {
    headline: `The review rates these two moves even overall${immediateClause}.`,
    detail: facts.referenceSource === 'fritz'
      ? `Fritz prefers ${preferred}, while the Review Engine's heuristic prefers ${otherEngineAction}, but this review doesn't show an overall value edge between the two displayed placements.`
      : `The Review Engine prefers ${preferred}, while Fritz prefers ${otherEngineAction}; they ${branchNote}, but this review doesn't show an overall value edge between the two displayed placements.`,
    takeaway: '',
  };
}

function buildValueGapWithoutFeaturesProse(facts: ReviewCoachingFacts, expectedGap: number): ReviewCoachingProse {
  const authority = referenceAuthorityName(facts);
  const authorityStart = authority[0].toUpperCase() + authority.slice(1);
  const preferred = preferredValueGapSubject(facts);
  const immediateSame = facts.deltas.immediatePoints === 0;
  const detail = immediateSame
    ? 'Both moves score the same immediately, but we don\'t have a reliable single positional reason for the gap.'
    : 'We don\'t have a reliable single positional reason for the gap.';
  return {
    headline: `${authorityStart} prefers ${preferred} by about ${formatNumber(expectedGap)} ${pointsWord(expectedGap)} overall.`,
    detail,
    takeaway: '',
  };
}

function buildImmediateOnlyGapProse(facts: ReviewCoachingFacts): ReviewCoachingProse {
  const referenceAction = actionLabel(facts.best.action);
  const gap = facts.deltas.immediatePoints;
  return {
    headline: `${referenceAction} scores ${formatNumber(gap)} more ${pointsWord(gap)} immediately.`,
    detail: '',
    takeaway: '',
  };
}

function buildCloseUnexplainedProse(facts: ReviewCoachingFacts): ReviewCoachingProse {
  const preferred = preferredValueGapSubject(facts);
  const authority = referenceAuthorityName(facts);
  if (facts.missKind === 'same_tile_wrong_end' || isSameTileWrongEnd(facts)) {
    const played = playAction(facts.played.action);
    const best = playAction(facts.best.action);
    const { playedSpot, bestSpot } = placementContrast(played, best);
    return {
      headline: sameTileWrongHeadline(facts),
      detail: `Play it at ${bestSpot}, not ${playedSpot}. The positional features we can measure don't give either placement a clear edge beyond that.`,
      takeaway: 'You found the right tile — check every legal end before placing it.',
    };
  }
  return {
    headline: 'This one is genuinely close.',
    detail: `${authority[0].toUpperCase() + authority.slice(1)} prefers ${preferred}, but the positional features we can measure don't give either placement a clear edge.`,
    takeaway: '',
  };
}

function buildFeatureBackedProse(
  facts: ReviewCoachingFacts,
  deltas: readonly ReviewFeatureDelta[],
): ReviewCoachingProse {
  const top = deltas[0];
  const why = joinWhyClauses(deltas);
  const sameTile = isSameTileWrongEnd(facts) || facts.missKind === 'same_tile_wrong_end';
  const played = playAction(facts.played.action);
  const best = playAction(facts.best.action);
  const { playedSpot, bestSpot } = placementContrast(played, best);
  const preferred = preferredValueGapSubject(facts);
  const authority = referenceAuthorityName(facts);
  const immediateGap = facts.deltas.immediatePoints;

  let headline = featureHeadlineFor(top, sameTile, facts);
  if (!sameTile && !why) {
    headline = `${authority[0].toUpperCase() + authority.slice(1)} prefers ${preferred} here.`;
  }

  let detail: string;
  if (sameTile && why) {
    detail = `Play it at ${bestSpot}, not ${playedSpot} — that placement ${why}.`;
  } else if (sameTile) {
    detail = `Play it at ${bestSpot}, not ${playedSpot}.`;
  } else if (why) {
    detail = `Prefer ${actionLabel(facts.best.action)} — it ${why}.`;
  } else {
    detail = `${authority[0].toUpperCase() + authority.slice(1)} prefers ${actionLabel(facts.best.action)}.`;
  }

  if (immediateGap !== 0) {
    const moreFewer = immediateGap > 0 ? 'more' : 'fewer';
    detail += ` ${actionLabel(facts.best.action)} scores ${formatNumber(immediateGap)} ${moreFewer} ${pointsWord(immediateGap)} immediately.`;
  }

  const takeaway = sameTile
    ? 'You found the right tile — check every legal end before placing it.'
    : top.feature === 'opponentOutsLeft' || top.feature === 'endDangerPenalty'
      ? 'When two moves score the same, prefer the one that leaves fewer easy replies.'
      : '';

  return { headline, detail, takeaway };
}

/**
 * Player-facing precedence (positional path):
 * 1. played === displayed reference → affirmative
 * 2. true displayed-value equality → equality (never "wrong end")
 * 3. supported positional WHY → coaching explanation
 * 4. supported overall value gap, no WHY → value-gap fallback
 * 5. otherwise close/unexplained
 * Contested disagreement disclosure composes with 2–5 without contradicting them.
 */
function buildFeatureDeltaProse(facts: ReviewCoachingFacts, includeTrueReferenceEquality: boolean): ReviewCoachingProse {
  const deltas = (facts.featureDeltas ?? []).filter(referenceWinsFeature);
  const top = deltas[0];
  const expectedGap = facts.deltas.referenceExpectedPointDifferential;
  const immediateGap = facts.deltas.immediatePoints;

  if (actionsEqual(facts.played.action, facts.best.action)) {
    return buildMatchedReferenceProse(facts);
  }

  // Equality outranks missKind / feature-backed "wrong end" language.
  if (isTrueDisplayedEquality(facts, includeTrueReferenceEquality)) {
    return buildTrueEqualityProse(facts, false);
  }

  if (top) {
    return buildFeatureBackedProse(facts, deltas);
  }

  if (expectedGap !== undefined && expectedGap >= VALUE_GAP_MIN_POINTS) {
    return buildValueGapWithoutFeaturesProse(facts, expectedGap);
  }

  if (!top && immediateGap > 0 && (expectedGap === undefined || expectedGap >= 0)) {
    return buildImmediateOnlyGapProse(facts);
  }

  return buildCloseUnexplainedProse(facts);
}

/**
 * Contested search/heuristic: disclose disagreement once, then the
 * D2-aligned primary preference, then at most one supported WHY.
 * Heuristic contested never issues an unsupported placement imperative.
 */
function buildContestedFeatureDeltaProse(facts: ReviewCoachingFacts, includeTrueReferenceEquality: boolean): ReviewCoachingProse {
  if (actionsEqual(facts.played.action, facts.best.action)) {
    return buildMatchedReferenceProse(facts);
  }

  if (isTrueDisplayedEquality(facts, includeTrueReferenceEquality)) {
    return buildTrueEqualityProse(facts, true);
  }

  const deltas = (facts.featureDeltas ?? []).filter(referenceWinsFeature);
  const why = joinWhyClauses(deltas);
  const opposing = (facts.featureDeltas ?? []).filter(playedWinsFeature);
  const preferred = actionLabel(facts.best.action);
  const preferredShort = preferredValueGapSubject(facts);
  const otherEngineAction = facts.referenceSource === 'fritz'
    ? (facts.oracleMove ? actionLabel(facts.oracleMove.action) : 'a different line')
    : (facts.fritzMove ? actionLabel(facts.fritzMove.action) : 'a different line');
  const sameTile = isSameTileWrongEnd(facts) || facts.missKind === 'same_tile_wrong_end';
  const played = playAction(facts.played.action);
  const best = playAction(facts.best.action);
  const { playedSpot, bestSpot } = placementContrast(played, best);
  const expectedGap = facts.deltas.referenceExpectedPointDifferential;
  const lineSubject = preferredLineSubject(facts);

  if (facts.referenceSource === 'fritz') {
    // D2: Fritz is primary for heuristic disagreements — not exact truth.
    // Contested ≠ “close”: without a grounded displayed-reference value gap,
    // never claim the alternatives are nearly equal.
    // With no supported feature WHY, stop after the disagreement headline.
    let detail = '';
    if (why) {
      // Only cite features that actually favor Fritz's displayed reference.
      detail = `Fritz's placement ${why}.`;
    } else if (opposing.length > 0) {
      detail = sameTile
        ? `The measured positional features favor ${playedSpot}, but Fritz prefers ${bestSpot}.`
        : `The measured positional features favor ${otherEngineAction}, but Fritz prefers ${preferred}.`;
    }
    // No "Play it at …" imperative: contested heuristic is a judgment call.
    return {
      headline: 'The engines disagree here.',
      detail,
      takeaway: '',
    };
  }

  let detail = contestedPreferenceClause(facts, preferred, otherEngineAction);
  if (why) {
    detail += ` ${lineSubject} ${why}.`;
  } else if (expectedGap !== undefined && expectedGap >= VALUE_GAP_MIN_POINTS) {
    detail += ` The Review Engine prefers ${preferredShort} by about ${formatNumber(expectedGap)} more ${pointsWord(expectedGap)} overall.`;
  } else if (sameTile) {
    detail += ` Prefer ${bestSpot}, not ${playedSpot}.`;
  }

  return {
    headline: sameTile ? sameTileWrongHeadline(facts) : 'The engines disagree here.',
    detail,
    takeaway: sameTile ? 'You found the right tile — check every legal end before placing it.' : '',
  };
}

function buildCorrectProse(facts: ReviewCoachingFacts): ReviewCoachingProse {
  const play = playAction(facts.played.action);
  const isHeuristic = facts.evidence.source === 'heuristic';
  const confidenceHedge = isHeuristic ? ", by the engine's early read" : '';

  if (play && facts.played.immediatePoints > 0) {
    const points = formatNumber(facts.played.immediatePoints);
    return {
      headline: `Top score available${isHeuristic ? ', likely' : ''} -- ${tileText(play.tile)} for ${points} ${pointsWord(facts.played.immediatePoints)}.`,
      detail: `Playing ${tileText(play.tile)} at ${positionText(play.position)} was the strongest option here${confidenceHedge}, scoring ${points} ${pointsWord(facts.played.immediatePoints)} on the spot.`,
      takeaway: 'Keep scanning the board for the highest-scoring line before you commit -- you found it this time.',
    };
  }

  if (play) {
    return {
      headline: `Solid pick -- ${tileText(play.tile)} held up as the strongest option${isHeuristic ? ' by the engine\'s early read' : ''}.`,
      detail: `${tileText(play.tile)} at ${positionText(play.position)} didn't score immediately, but it was still the best move available here${confidenceHedge}.`,
      takeaway: 'Not every good move scores right away -- this one set up the position correctly.',
    };
  }

  const word = nonPlayWord(facts.played.action);
  return {
    headline: `Right call to ${word ?? 'pass'} here.`,
    detail: `${word === 'draw' ? 'Drawing' : 'Passing'} was the strongest option in this position${confidenceHedge}, not just a fallback.`,
    takeaway: `Recognizing when ${word === 'draw' ? 'drawing' : 'passing'} beats forcing a play is its own skill.`,
  };
}

function buildForcedProse(facts: ReviewCoachingFacts): ReviewCoachingProse {
  const play = playAction(facts.played.action);
  if (play) {
    return {
      headline: `Only legal play -- ${tileText(play.tile)}.`,
      detail: `${tileText(play.tile)} at ${positionText(play.position)} was the only legal move on the board -- there was nothing else to weigh.`,
      takeaway: 'Nothing to review here -- this move plays itself.',
    };
  }
  const word = nonPlayWord(facts.played.action) ?? 'pass';
  return {
    headline: `Only legal option was to ${word}.`,
    detail: `No legal play existed here, so ${word === 'draw' ? 'drawing' : 'passing'} was forced.`,
    takeaway: 'Nothing to review here -- there was no real decision to make.',
  };
}

function buildSameTileWrongEndProse(facts: ReviewCoachingFacts): ReviewCoachingProse {
  // Explicit per the doc: this is never a tile-choice miss. `played.action`
  // and `best.action` carry the identical tile -- only phrase this around
  // position/end/branch, never as if a different tile should have been
  // played.
  const played = playAction(facts.played.action);
  const best = playAction(facts.best.action);
  const tile = best ? tileText(best.tile) : '';
  const { playedSpot, bestSpot } = placementContrast(played, best);

  const referenceExpectedGap = facts.deltas.referenceExpectedPointDifferential;
  const hasGap = (referenceExpectedGap !== undefined && referenceExpectedGap > 0) || facts.deltas.immediatePoints > 0;
  const gapClause = hasGap
    ? ` — worth about ${formatNumber(
        referenceExpectedGap !== undefined && referenceExpectedGap > 0 ? referenceExpectedGap : facts.deltas.immediatePoints,
      )} ${pointsWord(referenceExpectedGap !== undefined && referenceExpectedGap > 0 ? referenceExpectedGap : facts.deltas.immediatePoints)}`
    : '';

  return {
    headline: 'Right tile, wrong end.',
    detail: `${tile} belongs at ${bestSpot}, not ${playedSpot}${gapClause}.`,
    takeaway: 'You found the right tile — check every legal end before placing it.',
  };
}

function buildMissedScoreProse(facts: ReviewCoachingFacts): ReviewCoachingProse {
  const best = playAction(facts.best.action);
  const played = playAction(facts.played.action);
  const gap = formatNumber(facts.deltas.immediatePoints);
  const bestTile = best ? tileText(best.tile) : 'the best option';
  const bestSpot = best ? ` at ${positionText(best.position)}` : '';

  return {
    headline: `Left ${gap} ${pointsWord(facts.deltas.immediatePoints)} on the table.`,
    detail:
      played && best
        ? `${bestTile}${bestSpot} scored ${formatNumber(facts.best.immediatePoints)} ${pointsWord(facts.best.immediatePoints)} here, versus ${formatNumber(facts.played.immediatePoints)} ${pointsWord(facts.played.immediatePoints)} for ${tileText(played.tile)}.`
        : `The best option here scored ${formatNumber(facts.best.immediatePoints)} ${pointsWord(facts.best.immediatePoints)}, versus ${formatNumber(facts.played.immediatePoints)} ${pointsWord(facts.played.immediatePoints)} for the move played.`,
    takeaway: 'Before you play, check whether a different tile scores more right now -- that gap is the whole story on this move.',
  };
}

function buildReplyRiskProse(facts: ReviewCoachingFacts): ReviewCoachingProse {
  const referenceExpectedGap = facts.deltas.referenceExpectedPointDifferential;
  // This path normally has an oracle reference, but preserve the structured
  // contract for every caller: unavailable is not a zero-point tie.
  if (referenceExpectedGap === undefined) return buildUnknownProse(facts);
  const totalLoss = formatNumber(referenceExpectedGap);
  return {
    headline: `Even on the scoreboard now, costlier over the rest of the hand.`,
    detail: `This move scored about the same as the best option right now, but it left a position that cost roughly ${totalLoss} ${pointsWord(facts.deltas.expectedPointDifferential)} in expected value over the rest of the hand.`,
    takeaway: 'When two moves score the same immediately, the one that leaves you less exposed afterward is usually the better pick.',
  };
}

function buildBetterTileProse(facts: ReviewCoachingFacts): ReviewCoachingProse {
  const referenceExpectedGap = facts.deltas.referenceExpectedPointDifferential;
  // Do not turn an unavailable Fritz-relative value into a numeric claim.
  if (referenceExpectedGap === undefined) return buildUnknownProse(facts);
  const gap = formatNumber(referenceExpectedGap);
  const best = playAction(facts.best.action);
  return {
    headline: `A different tile rated higher${best ? ` -- ${tileText(best.tile)}` : ''} -- for no single clear reason.`,
    detail: `The numbers put this about ${gap} ${pointsWord(facts.deltas.expectedPointDifferential)} behind, without one dominant cause -- not purely the immediate score, and not purely what follows.`,
    takeaway: 'A closer call like this is worth a second look, but it is not a clear-cut mistake.',
  };
}

function buildPassOrDrawProse(facts: ReviewCoachingFacts): ReviewCoachingProse {
  const playedIsPlay = facts.played.action.kind === 'play';
  const bestIsPlay = facts.best.action.kind === 'play';
  const referenceExpectedGap = facts.deltas.referenceExpectedPointDifferential;
  const hasGap = referenceExpectedGap !== undefined && referenceExpectedGap > 0;
  const gapClause = hasGap
    ? ` -- worth about ${formatNumber(referenceExpectedGap)} ${pointsWord(referenceExpectedGap)}`
    : '';

  if (playedIsPlay && !bestIsPlay) {
    const bestWord = nonPlayWord(facts.best.action) ?? 'pass';
    return {
      headline: `${bestWord === 'draw' ? 'Drawing' : 'Passing'} was actually the stronger option.`,
      detail: `A tile was played here, but ${bestWord === 'draw' ? 'drawing' : 'passing'} instead was the better move${gapClause}.`,
      takeaway: `Playing a legal tile isn't always required -- weigh ${bestWord === 'draw' ? 'drawing' : 'passing'} too when the board is tight.`,
    };
  }

  if (!playedIsPlay && bestIsPlay) {
    const best = playAction(facts.best.action);
    const playedWord = nonPlayWord(facts.played.action) ?? 'pass';
    return {
      headline: `A play was actually available here.`,
      detail: `${playedWord === 'draw' ? 'Drawing' : 'Passing'} was played, but ${best ? tileText(best.tile) : 'a legal tile'} was on the board and was the stronger move${gapClause}.`,
      takeaway: `Double-check for a legal play before choosing to ${playedWord}.`,
    };
  }

  const playedWord = nonPlayWord(facts.played.action) ?? 'pass';
  const bestWord = nonPlayWord(facts.best.action) ?? 'draw';
  return {
    headline: `${bestWord === 'draw' ? 'Drawing' : 'Passing'} was the better non-play option.`,
    detail: `${playedWord === 'draw' ? 'Drawing' : 'Passing'} was chosen, but ${bestWord === 'draw' ? 'drawing' : 'passing'} was the stronger choice here${gapClause}.`,
    takeaway: `When you can't play, the choice between passing and drawing still matters.`,
  };
}

function buildUnknownProse(facts: ReviewCoachingFacts): ReviewCoachingProse {
  // 'unknown' in classifyMissKind is reached via two genuinely different
  // situations, distinguishable by evidence.source (already on the
  // object) -- collapsing them into one identical sentence would hide a
  // real distinction a player could otherwise learn to recognize:
  //  - heuristic tier: immediatePoints are tied, and the tier has no real
  //    calibrated value to fall back on -- the review genuinely hasn't
  //    resolved enough detail to say anything here, not a claim about the
  //    move itself.
  //  - precise tier (exact/search): a different-tile miss with a
  //    non-positive totalLoss, which should never happen from a real
  //    solver (best should always show value >= played's) -- this is a
  //    review-data inconsistency, not a real signal about the move.
  if (facts.evidence.source === 'heuristic') {
    return {
      headline: 'Too early in the review to say for sure.',
      detail: "This tier doesn't have enough resolved detail yet to explain why -- there isn't a reliable number to build a specific case on for this move.",
      takeaway: 'Not every move has a clean lesson attached -- this is one of them.',
    };
  }
  return {
    headline: "The numbers here don't add up to a clean explanation.",
    detail: 'This looks like a review-data gap, not something to change about your play -- there isn\'t a reliable number to build a specific case on for this move.',
    takeaway: 'Not every move has a clean lesson attached -- this is one of them.',
  };
}

/**
 * Builds the `prose` field D0 deliberately left undefined. Every string is
 * derived only from `facts` -- no claim here is unsupported by a field
 * already on the object (missKind, deltas, evidence, principalVariation,
 * played/best actions).
 */
export function buildReviewCoachingProse(
  facts: ReviewCoachingFacts,
  enablePositionalExplanations: boolean = REVIEW_POSITIONAL_EXPLANATIONS_ENABLED,
  includeTrueReferenceEquality: boolean = true,
): ReviewCoachingProse {
  if (enablePositionalExplanations && facts.featureDeltas && facts.missKind !== 'forced') {
    return facts.agreement?.contested
      ? buildContestedFeatureDeltaProse(facts, includeTrueReferenceEquality)
      : buildFeatureDeltaProse(facts, includeTrueReferenceEquality);
  }
  switch (facts.missKind) {
    case 'correct':
      return buildCorrectProse(facts);
    case 'forced':
      return buildForcedProse(facts);
    case 'same_tile_wrong_end':
      return buildSameTileWrongEndProse(facts);
    case 'missed_score':
      return buildMissedScoreProse(facts);
    case 'reply_risk':
      return buildReplyRiskProse(facts);
    case 'better_tile':
      return buildBetterTileProse(facts);
    case 'pass_or_draw':
      return buildPassOrDrawProse(facts);
    case 'unknown':
      return buildUnknownProse(facts);
  }
}
