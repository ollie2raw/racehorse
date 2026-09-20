import {
  boardTileCount,
  computePlayScore,
  DEFAULT_CONFIG,
  getOpenEnds,
  simulatePlacement,
  type Tile,
} from '@racehorse/game-core';
import type { ReviewAction, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import type { Config } from '@racehorse/game-core/types';
import { resolveHiddenPoolEligibility } from './hiddenPoolEligibility';
import {
  computeEndControlScore,
  computeEndDangerPenalty,
  computePressureScore,
  computeTrapPenalty,
  type HandPhase,
} from './solveHeuristicOpening';

/**
 * Positional-features module (feat/review-positional-features).
 *
 * Tier-agnostic, named numeric features over a single candidate action at a
 * `ReviewPositionSnapshotV2` decision point. Inputs are restricted to public
 * state, the acting player's own hand, and `knownMissingPipEvidence` --
 * never hidden opponent tiles -- the same information boundary
 * `solveHeuristicOpening.ts` (B4) already enforces.
 *
 * Every weighted term below is PORTED (re-derived against game-core's own
 * primitives and `ReviewPositionSnapshotV2`, not imported) from
 * `client/src/modules/fritz/botHeuristics.ts`'s `evaluateStrategicMove`
 * family -- read-only per the build brief, never modified. Where
 * `solveHeuristicOpening.ts` (B4) already carried out that port and exports
 * the resulting pure function (`computeEndControlScore`,
 * `computeEndDangerPenalty`, `computePressureScore`, `computeTrapPenalty`),
 * this module calls those exports directly rather than re-porting the same
 * formula a second time with a second chance to drift from the original.
 * The three features with no B4 equivalent (score-margin urgency,
 * boneyard/tile-count pressure, double/hub-opening risk) are ported fresh
 * here, following the same "read the original, keep the shape, drop
 * tier/wall-clock/noise" discipline B4's own file-header comment documents.
 *
 * Excluded, same reasoning as B4: bot-difficulty tier gating, TIER_SELECT
 * noise injection, wall-clock budgets, Monte Carlo opponent sampling, and
 * `minimaxFull`. This module is a single-ply, no-search feature reader --
 * never a move chooser.
 */

/** Every feature this module can produce, in the fixed order prose ranking iterates. */
export const POSITIONAL_FEATURE_NAMES = [
  'opponentOutsLeft',
  'endControlScore',
  'endDangerPenalty',
  'knownMissingPipExploitationScore',
  'handShapeOrphanCount',
  'handShapePlayableNext',
  'handShapeMobilityScore',
  'scoreMarginUrgency',
  'tileCountBoneyardPressure',
  'doubleHubOpeningRisk',
  'immediatePoints',
] as const;

export type PositionalFeatureName = (typeof POSITIONAL_FEATURE_NAMES)[number];

export type PositionalFeatures = Record<PositionalFeatureName, number>;

function pipTileFrequency(hand: readonly Tile[], maxPips: number): number[] {
  const freq = new Array<number>(maxPips + 1).fill(0);
  for (const t of hand) {
    freq[t.low] += 1;
    if (t.high !== t.low) freq[t.high] += 1;
  }
  return freq;
}

function isDoubleTile(t: Tile): boolean {
  return t.low === t.high;
}

function tileKey(t: Tile): string {
  const lo = Math.min(t.low, t.high);
  const hi = Math.max(t.low, t.high);
  return `${lo}-${hi}`;
}

function phaseFor(handSizeAfter: number, totalTilesAfter: number): HandPhase {
  if (handSizeAfter <= 3 || totalTilesAfter <= 8) return 'late';
  if (handSizeAfter <= 7 || totalTilesAfter <= 16) return 'mid';
  return 'early';
}

function evidenceWeight(reason: 'passed_on_open_end' | 'drew_past_open_end' | 'authority_observation'): number {
  if (reason === 'authority_observation') return 5;
  return 4;
}

function computeMissingWeightByPip(
  knownMissingPipEvidence: ReviewPositionSnapshotV2['preAction']['knownMissingPipEvidence'],
): Map<number, number> {
  const out = new Map<number, number>();
  for (const evidence of knownMissingPipEvidence) {
    const weight = evidenceWeight(evidence.reason);
    out.set(evidence.pip, Math.max(out.get(evidence.pip) ?? 0, weight));
  }
  return out;
}

/**
 * Raw count of unseen tiles that could immediately answer the resulting
 * open ends -- ported from `estimateOpponentCanPlayProbability`'s
 * `matchCount`, kept as a raw count here (rather than the probability that
 * function derives from it) so this feature reads as "opponent outs left",
 * a plain scoutable number, distinct from `endDangerPenalty`'s
 * support-discounted weighted version below.
 */
function computeOpponentOutsLeft(endsAfterValues: readonly number[], unseenPool: readonly Tile[]): number {
  if (endsAfterValues.length === 0) return 0;
  const endSet = new Set(endsAfterValues);
  return unseenPool.filter((t) => endSet.has(t.low) || endSet.has(t.high)).length;
}

/**
 * How urgently the score margin should bias play -- new feature, not a B4
 * port. Ported in spirit from the same input `evaluateStrategicMove` reads
 * for its own endgame-defense-weight bump (`youNearWin` in
 * `botHeuristics.ts`'s master-endgame branch: distance-to-winningTarget for
 * both sides), re-derived here from `ReviewPositionSnapshotV2.preAction`
 * only (public scores + winningTarget), never from a hidden field.
 * Positive = actor is closer to winning than the opponent (urgency to
 * finish); negative = opponent is closer (urgency to deny/stall).
 */
function computeScoreMarginUrgency(
  scores: ReviewPositionSnapshotV2['preAction']['scores'],
  winningTarget: number,
): number {
  const actorRemaining = Math.max(0, winningTarget - scores.actor);
  const opponentRemaining = Math.max(0, winningTarget - scores.opponent);
  const total = actorRemaining + opponentRemaining;
  if (total === 0) return 0;
  return ((opponentRemaining - actorRemaining) / total) * 100;
}

/**
 * Boneyard/tile-count pressure -- new feature, not a B4 port. How
 * constrained the drawable pool is relative to total tiles still in play
 * (own hand + opponent hand + drawable yard). Higher = tighter draw supply,
 * i.e. passes/misses are more costly and hand-shape bottlenecks matter
 * more. Ported in spirit from the same `boneyard.drawableCount` /
 * `refillRiskScore` inputs `evaluateStrategicMove` reads, re-derived as a
 * single normalized pressure number rather than that function's weighted
 * score contribution (which already lives in `handShapeMobilityScore`'s
 * ancestry via `computeTrapPenalty`/refill reasoning is NOT duplicated
 * here -- this feature is deliberately just the supply ratio, independent
 * of any specific candidate action).
 */
function computeTileCountBoneyardPressure(
  drawableCount: number,
  actorHandSize: number,
  opponentTileCount: number,
): number {
  const tilesInPlay = actorHandSize + opponentTileCount + drawableCount;
  if (tilesInPlay === 0) return 0;
  return (1 - drawableCount / tilesInPlay) * 100;
}

/**
 * Double/hub-opening risk for the played tile only (0 for a non-double
 * play, pass, or draw) -- ported from `branchPenalty` +
 * `earlyDoubleExposurePenalty`'s combined penalty magnitude, using the same
 * `unseenPool`-derived hold-weight approximation those functions use
 * (uniform weight per unseen tile, down-weighted for known-missing pips --
 * mirrors `solveHeuristicOpening.ts`'s own `holdWeights` construction so
 * this feature and that solver never silently diverge on what "hold
 * weight" means).
 */
function computeDoubleHubOpeningRisk(
  tile: Tile | null,
  actorHandAfter: readonly Tile[],
  holdWeights: ReadonlyMap<string, number>,
  immediateScore: number,
  tilesOnBoardBefore: number,
  maxPips: number,
): number {
  if (!tile || !isDoubleTile(tile)) return 0;
  const pip = tile.low;

  let branchRisk = 0;
  const ourFollowups = actorHandAfter.filter(
    (t) => (t.low === pip || t.high === pip) && !(t.low === pip && t.high === pip),
  ).length;
  let oppFollowupWeight = 0;
  for (let other = 0; other <= maxPips; other += 1) {
    if (other === pip) continue;
    oppFollowupWeight += holdWeights.get(tileKey({ low: pip, high: other })) ?? 0;
  }
  if (ourFollowups === 0 && oppFollowupWeight > 1.5) branchRisk = 40 + oppFollowupWeight * 8;
  else if (oppFollowupWeight > ourFollowups * 2) branchRisk = 15 + (oppFollowupWeight - ourFollowups) * 5;

  let exposureRisk = 0;
  if (tilesOnBoardBefore <= 8 && immediateScore <= 0) {
    const followups = actorHandAfter.filter((t) => !isDoubleTile(t) && (t.low === pip || t.high === pip)).length;
    let oppWeightOnPip = 0;
    for (let other = 0; other <= maxPips; other += 1) {
      oppWeightOnPip += holdWeights.get(tileKey({ low: pip, high: other })) ?? 0;
    }
    let penalty = 55 + oppWeightOnPip * 6;
    if (followups >= 3) penalty -= 25;
    else if (followups >= 2) penalty -= 12;
    exposureRisk = Math.max(0, penalty);
  }

  return branchRisk + exposureRisk;
}

/**
 * Computes the v1 positional feature set for one candidate action at a
 * review decision point. Never reads opponent hand identities -- only
 * `snapshot.preAction` (public + actor's own hand + accumulated
 * `knownMissingPipEvidence`) and the candidate action itself.
 *
 * A `pass`/`draw` action produces the position-shape features (hand-shape,
 * boneyard pressure, score-margin urgency all describe the PRE-action
 * position, independent of the action) with the action-dependent features
 * (endControlScore, endDangerPenalty, knownMissingPipExploitationScore,
 * doubleHubOpeningRisk, immediatePoints) at their neutral value (0) -- the
 * same "no board change, no strategic upside to model" convention
 * `solveHeuristicOpening.ts`'s `scoreAction` uses for non-play actions.
 */
export function computePositionalFeatures(
  snapshot: ReviewPositionSnapshotV2,
  action: ReviewAction,
  maxPips = 6,
): PositionalFeatures {
  const { actorHand, board, opponentTileCount, knownMissingPipEvidence } = snapshot.preAction;
  const { eligibleForOpponent, excludedTiles } = resolveHiddenPoolEligibility(snapshot, maxPips);
  const unseenPool = [...eligibleForOpponent, ...excludedTiles];
  const excludedPips = new Set(knownMissingPipEvidence.map((e) => e.pip));
  const holdWeights = new Map<string, number>();
  for (const tile of unseenPool) {
    holdWeights.set(tileKey(tile), excludedPips.has(tile.low) || excludedPips.has(tile.high) ? 0.05 : 1.0);
  }
  const missingWeights = computeMissingWeightByPip(knownMissingPipEvidence);
  const config: Config = { ...DEFAULT_CONFIG, maxPips, winningScore: snapshot.preAction.winningTarget };

  const endsBeforeValues = getOpenEnds(board).map((e) => e.matchValue);
  const tilesOnBoardBefore = boardTileCount(board);

  const scoreMarginUrgency = computeScoreMarginUrgency(snapshot.preAction.scores, snapshot.preAction.winningTarget);
  const tileCountBoneyardPressure = computeTileCountBoneyardPressure(
    snapshot.preAction.boneyard.drawableCount,
    actorHand.length,
    opponentTileCount,
  );

  if (action.kind !== 'play') {
    const phase = phaseFor(actorHand.length, actorHand.length + opponentTileCount);
    const { trapPenalty: _trapPenalty, playableNext, orphanTiles } = computeTrapPenalty(
      actorHand,
      endsBeforeValues,
      phase,
    );
    void _trapPenalty;
    return {
      opponentOutsLeft: computeOpponentOutsLeft(endsBeforeValues, unseenPool),
      endControlScore: 0,
      endDangerPenalty: 0,
      knownMissingPipExploitationScore: 0,
      handShapeOrphanCount: orphanTiles,
      handShapePlayableNext: playableNext,
      handShapeMobilityScore: playableNext - orphanTiles,
      scoreMarginUrgency,
      tileCountBoneyardPressure,
      doubleHubOpeningRisk: 0,
      immediatePoints: 0,
    };
  }

  const boardAfter = simulatePlacement(board, action.tile, action.position);
  const immediateScore = computePlayScore(boardAfter, config);
  const playedIndex = actorHand.findIndex(tile => tileKey(tile) === tileKey(action.tile));
  if (playedIndex < 0) throw new Error('Positional features require a tile in the actor hand.');
  const handAfter = actorHand.filter((_, index) => index !== playedIndex);
  const endsAfterValues = getOpenEnds(boardAfter).map((e) => e.matchValue);
  const totalTilesAfter = handAfter.length + opponentTileCount;
  const phase = phaseFor(handAfter.length, totalTilesAfter);
  const freq = pipTileFrequency(handAfter, maxPips);

  const endControlScore = computeEndControlScore(freq, endsAfterValues, phase);
  const endDangerPenalty = computeEndDangerPenalty(endsAfterValues, freq, unseenPool);
  const knownMissingPipExploitationScore = computePressureScore(endsBeforeValues, endsAfterValues, missingWeights);
  const { playableNext, orphanTiles } = computeTrapPenalty(handAfter, endsAfterValues, phase);
  const doubleHubOpeningRisk = computeDoubleHubOpeningRisk(
    action.tile,
    handAfter,
    holdWeights,
    immediateScore,
    tilesOnBoardBefore,
    maxPips,
  );

  return {
    opponentOutsLeft: computeOpponentOutsLeft(endsAfterValues, unseenPool),
    endControlScore,
    endDangerPenalty,
    knownMissingPipExploitationScore,
    handShapeOrphanCount: orphanTiles,
    handShapePlayableNext: playableNext,
    handShapeMobilityScore: playableNext - orphanTiles,
    scoreMarginUrgency,
    tileCountBoneyardPressure,
    doubleHubOpeningRisk,
    immediatePoints: immediateScore,
  };
}
