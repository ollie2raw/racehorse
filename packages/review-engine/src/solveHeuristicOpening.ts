import {
  boardTileCount,
  computePlayScore,
  DEFAULT_CONFIG,
  getOpenEnds,
  simulatePlacement,
  type Tile,
} from '@racehorse/game-core';
import {
  REVIEW_EVALUATION_VERSION,
  type ReviewAction,
  type ReviewCandidateEvaluationV1,
  type ReviewEvaluationV1,
  type ReviewPositionSnapshotV2,
} from '@racehorse/game-core/review';
import type { BoardState, Config } from '@racehorse/game-core/types';
import { resolveHiddenPoolEligibility } from './hiddenPoolEligibility';

export type HandPhase = 'early' | 'mid' | 'late';

/**
 * B4 (game-review-oracle-upgrade-2026-09-13.md): the opening / insufficient-
 * coverage path. Unlike B1-B3, this does no hidden-state resolution and no
 * search at all -- it's a single-ply heuristic read of each of the actor's
 * `legalActions`, built only from public+actor-known facts (own hand,
 * board, evidence, public counts). Nothing here is imported from
 * `client/src/modules/fritz/botHeuristics.ts` -- that file's leaf-scoring
 * formulas are *ported* (re-implemented against `ReviewPositionSnapshotV2`
 * and game-core's own primitives), not reused directly, since its actual
 * functions are coupled to a client-local `BotMatchState` wrapper (confirmed
 * during research: its `getLegalMoves`/`previewPlayMove` come from
 * `client/src/modules/fritz/../match/runtime/botEngine.ts`, not
 * `packages/game-core`).
 *
 * Explicitly excluded, confirmed not portable during research:
 *  - anything gated on bot difficulty tier ("isMaster" branches in the
 *    original) -- those are deliberate tactical amplifiers for a strong
 *    opponent, not an objective read of the position.
 *  - `TIER_SELECT` / weighted-random candidate selection -- a
 *    post-scoring noise-injection step for weaker difficulties, not a
 *    feature.
 *  - any wall-clock budget (e.g. `MASTER_ENDGAME_BUDGET_MS`) -- this
 *    package's fixed-budget convention (B0-B3) already replaces that.
 *  - Monte Carlo opponent-hand sampling and `minimaxFull` -- both do real
 *    search/sampling work that has no place in a no-search heuristic path,
 *    and both were already flagged during B2's research as
 *    `BotMatchState`-coupled and unsuitable for this package.
 */
function pipTileFrequency(hand: readonly Tile[], maxPips: number): number[] {
  const freq = new Array<number>(maxPips + 1).fill(0);
  for (const t of hand) {
    freq[t.low] += 1;
    if (t.high !== t.low) freq[t.high] += 1;
  }
  return freq;
}

function countPlayableTiles(hand: readonly Tile[], openEndValues: readonly number[]): number {
  const endSet = new Set(openEndValues);
  return hand.filter((t) => endSet.has(t.low) || endSet.has(t.high)).length;
}

function countOrphanTiles(hand: readonly Tile[], openEndValues: readonly number[]): number {
  const endSet = new Set(openEndValues);
  return hand.filter((t) => !endSet.has(t.low) && !endSet.has(t.high)).length;
}

function countTilesMatchingPip(tiles: readonly Tile[], pip: number): number {
  return tiles.filter((t) => t.low === pip || t.high === pip).length;
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

/**
 * Own-hand pip-frequency support for the resulting open ends, phase-
 * weighted -- ported directly from `evaluateStrategicMove`'s
 * `endControlScore` (the "base", non-tier-gated terms only).
 */
export function computeEndControlScore(
  freq: readonly number[],
  endsAfterValues: readonly number[],
  phase: HandPhase,
): number {
  const endSupportWeight = phase === 'early' ? 7 : phase === 'mid' ? 5 : 3;
  const endWeakPenalty = phase === 'early' ? 8 : phase === 'mid' ? 6 : 3;
  return (
    endsAfterValues.reduce((sum, e) => sum + endSupportWeight * (freq[e] ?? 0), 0) -
    endsAfterValues.reduce((sum, e) => sum + endWeakPenalty * Math.max(0, 2 - (freq[e] ?? 0)), 0)
  );
}

/**
 * How many *unseen* tiles could immediately punish the resulting open
 * ends, discounted by own-hand support for that end -- ported directly
 * from `endDangerPenalty`. Deliberately evidence-agnostic (a raw unseen-
 * pool count), matching the original: evidence-based reasoning about the
 * opponent lives in `computePressureScore`, not here.
 */
export function computeEndDangerPenalty(
  endsAfterValues: readonly number[],
  freq: readonly number[],
  unseenPool: readonly Tile[],
): number {
  const dangerWeight = 2.0;
  return endsAfterValues.reduce((sum, e) => {
    const availableMatches = countTilesMatchingPip(unseenPool, e);
    const support = freq[e] ?? 0;
    return sum + (dangerWeight * availableMatches) / (1 + 0.6 * support);
  }, 0);
}

/**
 * Reward creating an open end the opponent is evidenced not to hold (a
 * real denial), penalize removing one -- ported from `pressureScore`.
 * `missingWeights` is this file's own, deliberately simplified mapping
 * from `knownMissingPipEvidence` (flat per-reason weight, no age decay) --
 * Fritz's original `computeMissingWeightByPip` decays weight by hand/turn
 * age using fields Review's evidence model doesn't carry the same way, and
 * Review's own evidence is already known to be accumulate-only / never
 * invalidated (issue #220) -- porting the decay curve exactly would imply
 * a precision this input doesn't support. Flagged here rather than
 * silently matched.
 */
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

export function computePressureScore(
  endsBeforeValues: readonly number[],
  endsAfterValues: readonly number[],
  missingWeights: ReadonlyMap<number, number>,
): number {
  const pressureBonus = endsAfterValues.reduce((sum, e) => sum + (missingWeights.get(e) ?? 0), 0);
  const pressurePenalty = endsBeforeValues
    .filter((e) => !endsAfterValues.includes(e))
    .reduce((sum, e) => sum + (missingWeights.get(e) ?? 0), 0);
  return pressureBonus - pressurePenalty;
}

/**
 * Own-hand mobility after the move -- ported from `trapPenalty`. Returns
 * the intermediate `playableNext`/`orphanTiles` counts alongside the
 * penalty since callers (and this file's spot-check tests) need them too.
 */
export function computeTrapPenalty(
  handAfter: readonly Tile[],
  endsAfterValues: readonly number[],
  phase: HandPhase,
): { trapPenalty: number; playableNext: number; orphanTiles: number } {
  const playableNext = countPlayableTiles(handAfter, endsAfterValues);
  const orphanTiles = countOrphanTiles(handAfter, endsAfterValues);
  const bottleneck = playableNext <= 1 ? 1 : 0;
  const targetPlayable = phase === 'early' ? 3 : phase === 'mid' ? 2 : 1;

  const orphanPenalty = phase === 'early' ? 18 : phase === 'mid' ? 15 : 9;
  const bottleneckPenalty = phase === 'early' ? 36 : phase === 'mid' ? 26 : 12;
  const lowMobilityPenalty = phase === 'early' ? 10 : phase === 'mid' ? 8 : 4;

  const trapPenalty =
    orphanPenalty * orphanTiles +
    bottleneckPenalty * bottleneck +
    lowMobilityPenalty * Math.max(0, targetPlayable - playableNext);

  return { trapPenalty, playableNext, orphanTiles };
}

/** Fair probabilistic estimate of opponent mobility over the resulting open ends -- ported from `estimateOpponentMobilityApprox`. */
function estimateOpponentMobilityApprox(
  endsValues: readonly number[],
  holdWeights: ReadonlyMap<string, number>,
  maxPips: number,
): number {
  if (endsValues.length === 0) return 0;
  let total = 0;
  for (const end of endsValues) {
    for (let pip = 0; pip <= maxPips; pip += 1) {
      total += holdWeights.get(tileKey({ low: end, high: pip })) ?? 0;
    }
  }
  return total / endsValues.length;
}

/** Ported from `branchPenalty`: discourage playing a double that leaves the opponent more follow-up options on that pip than the actor has. */
function computeBranchPenalty(
  tile: Tile,
  actorHandAfter: readonly Tile[],
  holdWeights: ReadonlyMap<string, number>,
  maxPips: number,
): number {
  if (!isDoubleTile(tile)) return 0;
  const pip = tile.low;
  const ourFollowups = actorHandAfter.filter(
    (t) => (t.low === pip || t.high === pip) && !(t.low === pip && t.high === pip),
  ).length;

  let oppFollowupWeight = 0;
  for (let other = 0; other <= maxPips; other += 1) {
    if (other === pip) continue;
    oppFollowupWeight += holdWeights.get(tileKey({ low: pip, high: other })) ?? 0;
  }

  if (ourFollowups === 0 && oppFollowupWeight > 1.5) return 40 + oppFollowupWeight * 8;
  if (oppFollowupWeight > ourFollowups * 2) return 15 + (oppFollowupWeight - ourFollowups) * 5;
  return 0;
}

/** Ported from `earlyDoubleExposurePenalty`: aggressively discourage early non-scoring doubles unless strongly supported. */
function computeEarlyDoubleExposurePenalty(
  tile: Tile,
  actorHandAfter: readonly Tile[],
  holdWeights: ReadonlyMap<string, number>,
  immediateScore: number,
  tilesOnBoardBefore: number,
  maxPips: number,
): number {
  if (!isDoubleTile(tile)) return 0;
  if (tilesOnBoardBefore > 8) return 0;
  if (immediateScore > 0) return 0;

  const pip = tile.low;
  const followups = actorHandAfter.filter((t) => !isDoubleTile(t) && (t.low === pip || t.high === pip)).length;
  let oppWeightOnPip = 0;
  for (let other = 0; other <= maxPips; other += 1) {
    oppWeightOnPip += holdWeights.get(tileKey({ low: pip, high: other })) ?? 0;
  }

  let penalty = 55 + oppWeightOnPip * 6;
  if (followups >= 3) penalty -= 25;
  else if (followups >= 2) penalty -= 12;
  return Math.max(0, penalty);
}

/** Fair probability estimate that the opponent can reply at all -- ported from `estimateOpponentCanPlayProbability`. */
function estimateOpponentCanPlayProbability(
  openEndValues: readonly number[],
  unseenPool: readonly Tile[],
  opponentTileCount: number,
): number {
  if (openEndValues.length === 0 || unseenPool.length === 0 || opponentTileCount <= 0) return 0;
  const endSet = new Set(openEndValues);
  const matchCount = unseenPool.filter((t) => endSet.has(t.low) || endSet.has(t.high)).length;
  if (matchCount <= 0) return 0;
  const pSingle = Math.min(1, matchCount / unseenPool.length);
  const pNone = Math.pow(1 - pSingle, Math.max(0, opponentTileCount));
  return Math.max(0, Math.min(1, 1 - pNone));
}

/** Minimal, self-contained lookahead over the actor's own remaining hand only (never the opponent's) -- ported from `hasExitInTwoMoves`. */
function canExitWithinTwoOwnMoves(hand: readonly Tile[], board: BoardState | null): boolean {
  if (hand.length === 0) return true;
  const ends = getOpenEnds(board).map((e) => e.matchValue);
  for (const t1 of hand) {
    const matches1 = ends.some((e) => t1.low === e || t1.high === e);
    if (!matches1) continue;
    const boardAfter1 = simulatePlacement(board, t1, pickPosition(board, t1));
    const handAfter1 = hand.filter((t) => t !== t1);
    if (handAfter1.length === 0) return true;
    const ends2 = getOpenEnds(boardAfter1).map((e) => e.matchValue);
    for (const t2 of handAfter1) {
      const matches2 = ends2.some((e) => t2.low === e || t2.high === e);
      if (matches2 && handAfter1.length === 1) return true;
    }
  }
  return false;
}

/** Ported from `hasNearSafeFinishSetup`: with exactly 2 tiles left, is there a play that leaves a guaranteed-playable last tile? */
function hasNearSafeFinishSetup(handAfter: readonly Tile[], board: BoardState | null): boolean {
  if (handAfter.length !== 2) return false;
  const ends = getOpenEnds(board).map((e) => e.matchValue);
  for (const t of handAfter) {
    if (!ends.some((e) => t.low === e || t.high === e)) continue;
    const boardAfter = simulatePlacement(board, t, pickPosition(board, t));
    const lastTile = handAfter.find((other) => other !== t)!;
    const endsAfter = getOpenEnds(boardAfter).map((e) => e.matchValue);
    if (endsAfter.some((e) => lastTile.low === e || lastTile.high === e)) return true;
  }
  return false;
}

/** Ported from `hasHubWithTwoOpenBranchesOnPip` -- game-core's own `BranchArm.openEnd` field, no reimplementation needed. */
function hasHubWithTwoOpenBranchesOnPip(board: BoardState | null, pip: number): boolean {
  if (!board) return false;
  for (const hub of board.hubDoubles ?? []) {
    let count = 0;
    for (const branch of hub.branches ?? []) {
      if (!branch) continue;
      if (branch.openEnd === pip) count += 1;
    }
    if (count >= 2) return true;
  }
  return false;
}

function pickPosition(board: BoardState | null, tile: Tile): 'left' | 'right' {
  if (!board) return 'left';
  const ends = getOpenEnds(board);
  const left = ends.find((e) => e.position === 'left');
  if (left && (tile.low === left.matchValue || tile.high === left.matchValue)) return 'left';
  return 'right';
}

function canonicalActionKey(action: ReviewAction): string {
  return action.kind === 'play' ? `play(${action.tile.low},${action.tile.high})@${action.position}` : action.kind;
}

type ScoredAction = {
  readonly action: ReviewAction;
  readonly immediatePoints: number;
  readonly score: number;
};

function scoreAction(
  snapshot: ReviewPositionSnapshotV2,
  action: ReviewAction,
  config: Config,
  unseenPool: readonly Tile[],
  holdWeights: ReadonlyMap<string, number>,
  missingWeights: ReadonlyMap<number, number>,
  maxPips: number,
): ScoredAction {
  const { actorHand, board } = snapshot.preAction;
  const endsBeforeValues = getOpenEnds(board).map((e) => e.matchValue);
  const tilesOnBoardBefore = boardTileCount(board);
  const opponentTileCount = snapshot.preAction.opponentTileCount;

  if (action.kind !== 'play') {
    // Pass/draw: no board change, no scoring, no strategic upside to model
    // beyond "this doesn't advance the position" -- scored as a flat 0
    // rather than fabricating a comparison the ported features have no
    // opinion about.
    return { action, immediatePoints: 0, score: 0 };
  }

  const boardAfter = simulatePlacement(board, action.tile, action.position);
  const immediateScore = computePlayScore(boardAfter, config);
  const handAfter = actorHand.filter((t) => t !== action.tile);
  const endsAfterValues = getOpenEnds(boardAfter).map((e) => e.matchValue);
  const totalTilesAfter = handAfter.length + opponentTileCount;
  const phase = phaseFor(handAfter.length, totalTilesAfter);
  const freq = pipTileFrequency(handAfter, maxPips);

  const endControlScore = computeEndControlScore(freq, endsAfterValues, phase);
  const endDangerPenalty = computeEndDangerPenalty(endsAfterValues, freq, unseenPool);
  const pressureScore = computePressureScore(endsBeforeValues, endsAfterValues, missingWeights);
  const { trapPenalty, playableNext } = computeTrapPenalty(handAfter, endsAfterValues, phase);

  let doubleScore = 0;
  if (isDoubleTile(action.tile)) {
    const followUps = handAfter.filter((t) => t.low === action.tile.low || t.high === action.tile.low).length;
    const oppMobilityAfter = estimateOpponentMobilityApprox(endsAfterValues, holdWeights, maxPips);
    const oppMobilityBefore = estimateOpponentMobilityApprox(endsBeforeValues, holdWeights, maxPips);
    const oppDelta = Math.max(0, oppMobilityAfter - oppMobilityBefore);

    if (phase === 'early' && followUps === 0 && immediateScore === 0) doubleScore -= 220;
    if (phase === 'early' && followUps === 0) doubleScore -= 65;
    doubleScore += Math.min(2, followUps) * 14;
    if (followUps === 0) doubleScore -= 26;
    if (oppDelta > Math.max(0, playableNext)) {
      doubleScore -= 20 + (oppDelta - Math.max(0, playableNext)) * 8;
    }
  }
  doubleScore -= computeBranchPenalty(action.tile, handAfter, holdWeights, maxPips);
  doubleScore -= computeEarlyDoubleExposurePenalty(
    action.tile,
    handAfter,
    holdWeights,
    immediateScore,
    tilesOnBoardBefore,
    maxPips,
  );

  let refillRiskScore = 0;
  const oppPlayProbability = estimateOpponentCanPlayProbability(endsAfterValues, unseenPool, opponentTileCount);
  if (oppPlayProbability < 0.55 && snapshot.preAction.boneyard.drawableCount > 2) {
    const unseenMatchCount = endsAfterValues.length === 0 ? 0 : unseenPool.filter((t) =>
      endsAfterValues.some((e) => t.low === e || t.high === e),
    ).length;
    const expectedDraws = unseenPool.length === 0
      ? 1
      : Math.max(1, Math.min(6, (unseenPool.length / Math.max(1, unseenMatchCount)) * 0.5));
    const certainty = Math.max(0.25, 1 - oppPlayProbability);
    if (phase === 'early') refillRiskScore -= (220 + expectedDraws * 25) * certainty;
    else if (phase === 'mid') refillRiskScore -= expectedDraws * 4 * certainty;
    else refillRiskScore += expectedDraws * 8 * certainty;
  }

  const outletTiles = handAfter.filter((t) => endsAfterValues.some((e) => t.low === e || t.high === e));
  let goldenBonus = 0;
  if (
    snapshot.preAction.boneyard.physicalCount > 2 &&
    handAfter.length <= 2 &&
    outletTiles.some(isDoubleTile)
  ) {
    goldenBonus = 90;
    const outletPips = new Set<number>();
    for (const t of outletTiles) {
      if (endsAfterValues.includes(t.low)) outletPips.add(t.low);
      if (endsAfterValues.includes(t.high)) outletPips.add(t.high);
    }
    const hasHubOutlet = Array.from(outletPips).some((pip) => hasHubWithTwoOpenBranchesOnPip(boardAfter, pip));
    if (hasHubOutlet) goldenBonus += 30;
  }

  let safeFinishBonus = 0;
  const outletCount = outletTiles.length;
  if (handAfter.length === 1 && outletCount >= 1) {
    safeFinishBonus += 140;
  } else if (handAfter.length === 2 && hasNearSafeFinishSetup(handAfter, boardAfter)) {
    safeFinishBonus += 90;
  }

  let exitBonus = 0;
  if (handAfter.length <= 3 && canExitWithinTwoOwnMoves(handAfter, boardAfter)) {
    exitBonus += 140;
  }

  const unloadTieBreaker = (action.tile.low + action.tile.high) * 0.5;
  const immediateWeight = 34;

  const score =
    immediateScore * immediateWeight +
    endControlScore -
    endDangerPenalty -
    trapPenalty +
    pressureScore +
    doubleScore +
    refillRiskScore +
    goldenBonus +
    safeFinishBonus +
    playableNext * 3 +
    unloadTieBreaker +
    exitBonus;

  return { action, immediatePoints: immediateScore, score };
}

export function solveHeuristicOpening(
  snapshot: ReviewPositionSnapshotV2,
  maxPips = 6,
): ReviewEvaluationV1 {
  const { eligibleForOpponent, excludedTiles } = resolveHiddenPoolEligibility(snapshot, maxPips);
  const unseenPool = [...eligibleForOpponent, ...excludedTiles];
  const excludedPips = new Set(snapshot.preAction.knownMissingPipEvidence.map((e) => e.pip));
  const holdWeights = new Map<string, number>();
  for (const tile of unseenPool) {
    holdWeights.set(tileKey(tile), excludedPips.has(tile.low) || excludedPips.has(tile.high) ? 0.05 : 1.0);
  }
  const missingWeights = computeMissingWeightByPip(snapshot.preAction.knownMissingPipEvidence);
  const config: Config = { ...DEFAULT_CONFIG, maxPips, winningScore: snapshot.preAction.winningTarget };

  const scored = snapshot.legalActions.map((action) =>
    scoreAction(snapshot, action, config, unseenPool, holdWeights, missingWeights, maxPips),
  );

  const candidates: ReviewCandidateEvaluationV1[] = scored.map((s) => ({
    action: s.action,
    // Fritz's heuristic score is an arbitrary-scale strategic signal (e.g.
    // "-220 for an unsupported early double"), not a calibrated point-
    // differential -- writing it into expectedPointDifferential would claim
    // a precision this model doesn't have (the same reasoning as B0's
    // stub: "a real expectedPointDifferential claim would be fabricated").
    // The candidate ORDER carries the opinion; the raw score is exposed
    // honestly via `diagnostics` instead (see below).
    //
    // This also means `loss` (computed from candidate values) is always
    // exactly 0 for every heuristic-only decision. That's safe only
    // because Phase C's design (game-review-oracle-upgrade-2026-09-13.md,
    // Phase C) already excludes heuristic-only decisions from the headline
    // accuracy aggregate entirely -- a zero loss here is never averaged
    // into a real accuracy number. If that exclusion rule ever changes,
    // this zero-differential choice needs revisiting too.
    value: { expectedPointDifferential: 0, winProbability: null },
    immediatePoints: s.immediatePoints,
    principalVariation: [],
  }));

  const order = scored
    .map((s, index) => ({ index, score: s.score }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return canonicalActionKey(scored[a.index].action) < canonicalActionKey(scored[b.index].action) ? -1 : 1;
    });

  const sortedCandidates = order.map((o) => candidates[o.index]);
  // diagnostics format: "<canonical action key>: <raw heuristic score>",
  // one entry per candidate, in the same order as `candidates`. This is a
  // deliberate, documented format -- not a free-form dumping ground -- so
  // future readers (and tests) can parse it.
  const diagnostics = order.map((o) => `${canonicalActionKey(scored[o.index].action)}: ${scored[o.index].score}`);

  const playedIndex = snapshot.legalActions.findIndex(
    (action) => canonicalActionKey(action) === canonicalActionKey(snapshot.actualAction),
  );
  const played = playedIndex >= 0 ? candidates[playedIndex] : sortedCandidates[0];
  const best = sortedCandidates[0];

  return {
    evaluationVersion: REVIEW_EVALUATION_VERSION,
    snapshotId: snapshot.identifiers.decisionId,
    rulesVersion: snapshot.rulesVersion,
    reviewEngineVersion: snapshot.reviewEngineVersion,
    evidence: {
      source: 'heuristic',
      confidence: 'low',
      // 'Heuristic estimate', not the scoping doc's "Fritz's read" copy --
      // ReviewEvaluationEvidence's 'heuristic' branch (game-core, locked
      // since B0) only permits this literal; see issue #224 for the
      // doc/type naming mismatch this surfaced, left for Phase D's UI work
      // to resolve rather than decided here.
      displayLabel: 'Heuristic estimate',
    },
    played,
    best,
    candidates: sortedCandidates,
    loss: { expectedPointDifferential: 0, winProbability: null },
    search: {
      nodes: sortedCandidates.length,
      depth: 0,
      hiddenStateSamples: 0,
      coverage: 0,
      complete: true,
    },
    diagnostics,
  };
}
