import {
  applyGameCommand,
  DEFAULT_CONFIG,
  computePlayScore,
  simulatePlacement,
  type Config,
  type GameState,
  type Tile,
} from '@racehorse/game-core';
import type { ReviewAction, ReviewCandidateEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import type { ReviewSearchBudget } from './evaluateReviewPosition';
import { resolveHiddenPoolEligibility } from './hiddenPoolEligibility';
import { sampleHiddenAllocation } from './sampleHiddenAllocation';
import { commandForAction, searchGameTree, type GameTreeWalkConfig, type NodeBudget } from './searchGameTree';

export type MidgameConvergence = {
  readonly sameTopAction: boolean;
  readonly valueDelta: number;
};

export type MidgameDeterminizationResult = {
  readonly candidates: readonly ReviewCandidateEvaluationV1[];
  readonly best: ReviewCandidateEvaluationV1;
  readonly nodes: number;
  readonly hiddenStateSamples: number;
  readonly coverage: number;
  readonly complete: boolean;
  readonly convergence: MidgameConvergence;
};

// Local, small duplicates of B2's identically-shaped helpers rather than a
// further shared module -- the design doc's B3 build only asked to extract
// the recursive minimax (now searchGameTree.ts); pulling these tiny sorting/
// key helpers out too would be scope creep beyond what was asked.
function sortTilesCanonically(tiles: readonly Tile[]): Tile[] {
  return [...tiles].sort((a, b) => {
    const aLo = Math.min(a.low, a.high);
    const aHi = Math.max(a.low, a.high);
    const bLo = Math.min(b.low, b.high);
    const bHi = Math.max(b.low, b.high);
    return aLo - bLo || aHi - bHi;
  });
}

function canonicalActionKey(action: ReviewAction): string {
  if (action.kind === 'play') {
    const lo = Math.min(action.tile.low, action.tile.high);
    const hi = Math.max(action.tile.low, action.tile.high);
    return JSON.stringify({ tile: [lo, hi], position: action.position });
  }
  return JSON.stringify({ kind: action.kind });
}

function immediatePointsForAction(
  board: ReviewPositionSnapshotV2['preAction']['board'],
  config: Config,
  action: ReviewAction,
): number {
  if (action.kind !== 'play') return 0;
  return computePlayScore(simulatePlacement(board, action.tile, action.position), config);
}

/** Closed-form n-choose-k -- no enumeration needed, safe for the tile counts in play here (n <= 28). */
function combinationCount(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 0; i < k; i += 1) {
    result = (result * (n - i)) / (i + 1);
  }
  return Math.round(result);
}

function canonicalTileKey(tile: Tile): string {
  const lo = Math.min(tile.low, tile.high);
  const hi = Math.max(tile.low, tile.high);
  return `${lo}-${hi}`;
}

function buildRootState(
  snapshot: ReviewPositionSnapshotV2,
  opponentHand: readonly Tile[],
  boneyardDrawable: readonly Tile[],
  boneyardDead: readonly Tile[],
  config: Config,
): GameState {
  const { actorId, opponentId, handNumber } = snapshot.identifiers;
  const { actorHand, board, scores, consecutivePasses, handOpen } = snapshot.preAction;
  return {
    config,
    playerIds: [actorId, opponentId],
    players: {
      [actorId]: { id: actorId, hand: actorHand, score: scores.actor },
      [opponentId]: { id: opponentId, hand: opponentHand, score: scores.opponent },
    },
    board,
    // deadTiles are the protected tail of boneyard, not a separate pool
    // (engine.ts's own dealing convention: `deadTiles = remaining.slice(
    // remaining.length - deadTileCount)`, still counted inside `boneyard`).
    // Getting this right matters here -- unlike B2, drawableCount is
    // genuinely nonzero, so getDrawableBoneyardCount (boneyard.length -
    // config.deadTileCount) must land on the real drawable count for the
    // forced-draw handling in searchGameTree to trigger correctly.
    boneyard: [...boneyardDrawable, ...boneyardDead],
    deadTiles: boneyardDead,
    currentPlayerIndex: 0,
    handNumber,
    handOpen,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses,
    sequence: 0,
  };
}

function buildCandidates(
  legalActions: readonly ReviewAction[],
  board: ReviewPositionSnapshotV2['preAction']['board'],
  config: Config,
  totals: readonly number[],
  solvedCount: number,
): ReviewCandidateEvaluationV1[] {
  const candidates: ReviewCandidateEvaluationV1[] = legalActions.map((action, index) => ({
    action,
    value: {
      expectedPointDifferential: solvedCount > 0 ? totals[index] / solvedCount : 0,
      winProbability: null,
    },
    immediatePoints: immediatePointsForAction(board, config, action),
    principalVariation: [],
  }));

  candidates.sort((a, b) => {
    if (b.value.expectedPointDifferential !== a.value.expectedPointDifferential) {
      return b.value.expectedPointDifferential - a.value.expectedPointDifferential;
    }
    return canonicalActionKey(a.action) < canonicalActionKey(b.action) ? -1 : 1;
  });

  return candidates;
}

/**
 * B3 (game-review-oracle-upgrade-2026-09-13.md): midgame determinization /
 * bounded-depth expectimax. Unlike B2 (locked yard, exhaustive-to-terminal),
 * B3 handles positions where the hidden-allocation space is too large to
 * enumerate -- it samples `budget.maxHiddenStateSamples` full hidden
 * allocations via B1's `sampleHiddenAllocation` (sub-seeds derived as
 * `${seed}:${i}`, the same "prefix:index" convention already used
 * throughout this codebase's fixtures), and for each sampled allocation
 * runs a depth-bounded minimax (the shared `searchGameTree` walker, cut off
 * at `maxPlyDepth` in addition to true terminal states) rather than
 * searching to the hand's real end.
 *
 * Two decisions locked in before this build, per the research pass:
 *  - Adjustment 1: total feasibility is a single up-front check --
 *    `C(eligibleForOpponent.length, opponentTileCount)` -- not a per-sample
 *    null-skip. `sampleHiddenAllocation`'s feasibility doesn't vary by seed,
 *    so a null on sample 0 would mean every subsequent sample is also null;
 *    checking once up front avoids attempting any sampling at all when the
 *    answer is already known to be null.
 *  - coverage = distinct canonical opponent-hand identities seen / that same
 *    C(n,k) denominator, capped at 1.0 -- the decision-relevant dimension of
 *    the hidden space (see B3's research report for why boneyard draw order
 *    is excluded from this denominator: a bounded-depth search mostly
 *    doesn't reach far enough for it to matter). Because sub-seeds are a
 *    fixed, deterministically-ordered sequence and a larger budget is
 *    always a strict prefix superset of a smaller one, this coverage
 *    definition is monotonic non-decreasing in budget *by construction*,
 *    not just empirically -- the whole point of the "prefix" sub-seed
 *    scheme.
 *  - convergence is a within-the-same-pass checkpoint: the running
 *    per-action totals are snapshotted at the halfway sample index (no
 *    second search), then compared to the final ranking. `ReviewEvaluationV1`
 *    (game-core's contract type) has no field for this, and extending it
 *    would mean touching a B0 file -- so, following B2's own precedent of
 *    defining a bespoke local result type rather than returning
 *    `ReviewEvaluationV1` directly, `convergence` lives on this file's own
 *    `MidgameDeterminizationResult` instead.
 *
 * Like B2, `value.expectedPointDifferential` is the net swing from the
 * decision point (final differential at the search's cutoff minus the
 * differential already on the board), and `principalVariation` is left
 * empty for the same honest-stub reason B0-B2 already established.
 */
export function solveMidgameDeterminization(
  snapshot: ReviewPositionSnapshotV2,
  budget: ReviewSearchBudget,
  seed: string | number,
  maxPlyDepth: number,
  maxPips = 6,
  shouldStop?: () => boolean,
): MidgameDeterminizationResult | null {
  const { actorId, opponentId } = snapshot.identifiers;
  const { opponentTileCount, scores, board } = snapshot.preAction;
  const rootDiff = scores.actor - scores.opponent;

  const { eligibleForOpponent } = resolveHiddenPoolEligibility(snapshot, maxPips);
  const totalOpponentHandCombinations = combinationCount(eligibleForOpponent.length, opponentTileCount);

  // Adjustment 1: single up-front infeasibility check, no per-sample skipping.
  if (totalOpponentHandCombinations === 0) return null;

  const config: Config = {
    ...DEFAULT_CONFIG,
    maxPips,
    winningScore: snapshot.preAction.winningTarget,
    deadTileCount: snapshot.preAction.boneyard.deadCount,
  };

  const nodeBudget: NodeBudget = { count: 0, max: budget.maxNodes };

  const walkConfig: GameTreeWalkConfig = {
    shouldStop,
    actorId,
    opponentId,
    isCutoff: (state, depth) => state.handOver || state.gameOver || depth >= maxPlyDepth,
    leafValue: (state) => state.players[actorId].score - state.players[opponentId].score,
  };

  const totals = snapshot.legalActions.map(() => 0);
  const distinctOpponentHands = new Set<string>();
  const halfway = Math.floor(budget.maxHiddenStateSamples / 2);
  let checkpointTotals: number[] | null = null;
  let checkpointSolved = 0;
  let solvedSamples = 0;
  let complete = true;

  for (let i = 0; i < budget.maxHiddenStateSamples; i += 1) {
    if (shouldStop?.()) {
      complete = false;
      break;
    }
    const subSeed = `${seed}:${i}`;
    const allocation = sampleHiddenAllocation(snapshot, subSeed, maxPips);
    if (allocation === null) {
      // Adjustment 1's up-front C(n,k) > 0 check guarantees this can't
      // legitimately happen -- sampleHiddenAllocation's own feasibility
      // check doesn't vary by seed. Surfacing this loudly rather than
      // silently skipping, since it would mean the two feasibility checks
      // disagree, which is a real bug to find, not a per-seed edge case.
      throw new Error(
        'solveMidgameDeterminization: sampleHiddenAllocation returned null despite a positive ' +
          'up-front C(n,k) feasibility count -- this indicates the two feasibility checks disagree.',
      );
    }

    distinctOpponentHands.add(sortTilesCanonically(allocation.opponentHand).map(canonicalTileKey).join(','));

    const perActionDiffs: number[] = [];
    let sampleComplete = true;

    for (const action of snapshot.legalActions) {
      const rootState = buildRootState(snapshot, allocation.opponentHand, allocation.boneyardDrawable, allocation.boneyardDead, config);
      const command = commandForAction(rootState, actorId, action);
      const { state: postActionState } = applyGameCommand(rootState, command);
      const { finished, diff } = searchGameTree(postActionState, 0, walkConfig, nodeBudget);
      perActionDiffs.push(diff - rootDiff);
      if (!finished) sampleComplete = false;
    }

    if (!sampleComplete) {
      complete = false;
      break;
    }

    perActionDiffs.forEach((diff, index) => {
      totals[index] += diff;
    });
    solvedSamples += 1;

    if (halfway > 0 && solvedSamples === halfway) {
      checkpointTotals = [...totals];
      checkpointSolved = solvedSamples;
    }
  }

  if (solvedSamples < budget.maxHiddenStateSamples) complete = false;

  const coverage = Math.min(1, distinctOpponentHands.size / totalOpponentHandCombinations);

  const candidates = buildCandidates(snapshot.legalActions, board, config, totals, solvedSamples);
  const best = candidates[0];

  let convergence: MidgameConvergence;
  if (checkpointTotals !== null && checkpointSolved > 0) {
    const halfwayCandidates = buildCandidates(snapshot.legalActions, board, config, checkpointTotals, checkpointSolved);
    const halfwayBest = halfwayCandidates[0];
    convergence = {
      sameTopAction: canonicalActionKey(halfwayBest.action) === canonicalActionKey(best.action),
      valueDelta: Math.abs(best.value.expectedPointDifferential - halfwayBest.value.expectedPointDifferential),
    };
  } else {
    // No halfway checkpoint was reachable (budget too small to reach it, or
    // maxHiddenStateSamples < 2) -- report a neutral, non-fabricated default
    // rather than inventing a comparison from incomplete data.
    convergence = { sameTopAction: true, valueDelta: 0 };
  }

  return {
    candidates,
    best,
    nodes: nodeBudget.count,
    hiddenStateSamples: solvedSamples,
    coverage,
    complete,
    convergence,
  };
}
