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
 * feat/review-positional-features: human-readable label + polarity for
 * each `PositionalFeatureName` (`computePositionalFeatures.ts`), so a
 * ranked `ReviewFeatureDelta` can be phrased in the right direction --
 * "higherIsBetter: false" means a LOWER value is the stronger outcome for
 * the actor (e.g. leaving fewer orphaned tiles), so the phrasing below
 * inverts sign for those before saying which move "wins" that feature.
 * `scoreMarginUrgency` and `tileCountBoneyardPressure` are pre-action,
 * position-level facts (identical for every candidate action on a given
 * snapshot -- see computePositionalFeatures.ts) -- they never appear here
 * in practice, since their delta is always 0 and `buildFeatureDeltas`
 * already filters near-zero deltas out, but they're listed for
 * completeness/documentation of every `PositionalFeatureName`.
 */
const FEATURE_META: Record<PositionalFeatureName, { label: string; higherIsBetter: boolean }> = {
  opponentOutsLeft: { label: 'unseen tiles matching the open ends', higherIsBetter: false },
  endControlScore: { label: 'end control', higherIsBetter: true },
  endDangerPenalty: { label: 'exposure to an immediate reply', higherIsBetter: false },
  knownMissingPipExploitationScore: { label: 'exploiting a known gap in the opponent’s hand', higherIsBetter: true },
  handShapeOrphanCount: { label: 'orphaned tiles left in hand', higherIsBetter: false },
  handShapePlayableNext: { label: 'tiles you can follow up with', higherIsBetter: true },
  handShapeMobilityScore: { label: 'hand mobility', higherIsBetter: true },
  scoreMarginUrgency: { label: 'score-margin urgency', higherIsBetter: true },
  tileCountBoneyardPressure: { label: 'boneyard pressure', higherIsBetter: false },
  doubleHubOpeningRisk: { label: 'double/hub exposure risk', higherIsBetter: false },
  immediatePoints: { label: 'immediate points scored', higherIsBetter: true },
};

/** True when `referenceValue` is the stronger outcome for this feature, given its polarity. */
function referenceWinsFeature(delta: ReviewFeatureDelta): boolean {
  const meta = FEATURE_META[delta.feature];
  return meta.higherIsBetter ? delta.delta > 0 : delta.delta < 0;
}

function describeFeatureDelta(delta: ReviewFeatureDelta, referenceLabel: string, playedLabel: string): string {
  const meta = FEATURE_META[delta.feature];
  const magnitude = formatNumber(delta.delta);
  const winner = referenceWinsFeature(delta) ? referenceLabel : playedLabel;
  return `${winner} rates better on ${meta.label} (by ${magnitude})`;
}

function actionLabel(action: ReviewAction): string {
  const play = playAction(action);
  if (play) return `${tileText(play.tile)} at ${positionText(play.position)}`;
  const word = nonPlayWord(action);
  return word === 'draw' ? 'drawing' : 'passing';
}

/**
 * feat/review-positional-features, build brief item 2: "rewrite the prose
 * generator to produce prose from the RANKED FEATURE DELTA -- largest
 * supported difference first, largest-magnitude features driving the
 * headline sentence." Used whenever `facts.featureDeltas` is present and
 * non-empty (i.e. `buildReviewCoachingFacts` was given a real snapshot) --
 * every number quoted here is a `ReviewFeatureDelta.delta`/`playedValue`/
 * `referenceValue` or a `facts.deltas`/`played`/`best` field, per the D1
 * repo rule (enforced by reviewCoachingProse.truthTest.test.ts).
 */
function buildFeatureDeltaProse(facts: ReviewCoachingFacts): ReviewCoachingProse {
  const deltas = facts.featureDeltas ?? [];
  const referenceLabel = facts.referenceSource === 'fritz' ? "Fritz's read" : 'the engine’s line';
  const referenceAction = actionLabel(facts.best.action);
  const playedAction = actionLabel(facts.played.action);
  const top = deltas[0];
  const second = deltas[1];
  if (!top) return {
    headline: 'No meaningful positional difference in the measured features.',
    detail: `${playedAction} and ${referenceAction} have no feature difference above the reporting threshold.`,
    takeaway: 'The measured features do not explain a preference between these moves.',
  };

  const immediateClause =
    facts.deltas.immediatePoints !== 0
      ? ` ${referenceAction} scores ${formatNumber(facts.deltas.immediatePoints)} ${facts.deltas.immediatePoints > 0 ? 'more' : 'fewer'} ${pointsWord(facts.deltas.immediatePoints)} immediately.`
      : '';

  const headline = `${referenceAction} (${referenceLabel}) over ${playedAction} -- biggest gap: ${FEATURE_META[top.feature].label} (${formatNumber(top.delta)}).`;
  const detailParts = [describeFeatureDelta(top, referenceAction, playedAction)];
  if (second) detailParts.push(describeFeatureDelta(second, referenceAction, playedAction));
  const detail = `${detailParts.join('; ')}.${immediateClause}`;
  const takeaway = second
    ? `Two features separate these moves: ${FEATURE_META[top.feature].label} and ${FEATURE_META[second.feature].label}.`
    : `The largest measured difference here is ${FEATURE_META[top.feature].label}.`;

  return { headline, detail, takeaway };
}

/**
 * Same feature-delta basis as `buildFeatureDeltaProse`, but for a contested
 * decision (`facts.agreement.contested`, i.e. oracle and Fritz picked
 * different moves at search/heuristic tier) -- per the build brief,
 * disagreement must be surfaced honestly rather than presented as a
 * confident verdict, since `capSeverityForContestedDecision` is already
 * capping how harshly this decision can be labeled elsewhere in the
 * pipeline.
 */
function buildContestedFeatureDeltaProse(facts: ReviewCoachingFacts): ReviewCoachingProse {
  const base = buildFeatureDeltaProse(facts);
  const referenceAction = actionLabel(facts.best.action);
  const otherEngineAction = facts.referenceSource === 'fritz'
    ? (facts.oracleMove ? actionLabel(facts.oracleMove.action) : 'a different line')
    : (facts.fritzMove ? actionLabel(facts.fritzMove.action) : "Fritz's read");
  const otherEngineName = facts.referenceSource === 'fritz' ? "the Review Engine's heuristic" : 'Fritz';
  const disagreementNote = ` ${otherEngineName} would have played ${otherEngineAction} instead of ${referenceAction} here, so this read is contested.`;
  return {
    headline: `Contested: ${base.headline}`,
    detail: `${base.detail}${disagreementNote}`,
    takeaway: `${base.takeaway} The engines disagree on the reference move.`,
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
  const bestSpot = best ? positionText(best.position) : 'the other end';
  const playedSpot = played ? positionText(played.position) : 'this end';

  const hasGap = facts.deltas.expectedPointDifferential > 0 || facts.deltas.immediatePoints > 0;
  const gapClause = hasGap
    ? ` -- worth about ${formatNumber(
        facts.deltas.expectedPointDifferential > 0 ? facts.deltas.expectedPointDifferential : facts.deltas.immediatePoints,
      )} ${pointsWord(facts.deltas.expectedPointDifferential > 0 ? facts.deltas.expectedPointDifferential : facts.deltas.immediatePoints)}`
    : '';

  return {
    headline: `${tile}, better end -- play it at ${bestSpot}, not ${playedSpot}.`,
    detail: `${tile} was the correct tile; it just belongs at ${bestSpot} rather than ${playedSpot}${gapClause}.`,
    takeaway: 'Once you know the tile, check both ends before you place it -- the end matters as much as the tile.',
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
  const totalLoss = formatNumber(facts.deltas.expectedPointDifferential);
  return {
    headline: `Even on the scoreboard now, costlier over the rest of the hand.`,
    detail: `This move scored about the same as the best option right now, but it left a position that cost roughly ${totalLoss} ${pointsWord(facts.deltas.expectedPointDifferential)} in expected value over the rest of the hand.`,
    takeaway: 'When two moves score the same immediately, the one that leaves you less exposed afterward is usually the better pick.',
  };
}

function buildBetterTileProse(facts: ReviewCoachingFacts): ReviewCoachingProse {
  const gap = formatNumber(facts.deltas.expectedPointDifferential);
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
  const hasGap = facts.deltas.expectedPointDifferential > 0;
  const gapClause = hasGap
    ? ` -- worth about ${formatNumber(facts.deltas.expectedPointDifferential)} ${pointsWord(facts.deltas.expectedPointDifferential)}`
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
export function buildReviewCoachingProse(facts: ReviewCoachingFacts, enablePositionalExplanations: boolean = REVIEW_POSITIONAL_EXPLANATIONS_ENABLED): ReviewCoachingProse {
  if (enablePositionalExplanations && facts.featureDeltas && facts.missKind !== 'forced') {
    return facts.agreement?.contested ? buildContestedFeatureDeltaProse(facts) : buildFeatureDeltaProse(facts);
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
