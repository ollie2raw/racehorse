import {
  applyGameCommand,
  DEFAULT_CONFIG,
  computePlayScore,
  simulatePlacement,
  tileEquals,
  type Config,
  type GameState,
  type Tile,
} from '@racehorse/game-core';
import type { ReviewAction, ReviewCandidateEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { countCombinations, enumerateCombinationsLazy } from './combinations';
import { resolveHiddenPoolEligibility } from './hiddenPoolEligibility';
import { commandForAction, searchGameTree, type GameTreeWalkConfig } from './searchGameTree';

/**
 * F4b safety-net wall-clock ceiling for a single solveExactEndgame call when
 * callers do not pass `maxWallClockMs`. Provenance: recovered F4 WIP
 * (`11765141` / `f1b8e0aa`) — deliberately generous vs the ~473ms observed
 * oracle max on recorded-corpus data (Phase F / Fritz audit latency tail),
 * so it only catches pathological hidden-pool enumeration, not normal
 * fixtures. Not a tuned product latency SLO.
 */
export const EXACT_ENDGAME_DEFAULT_WALL_CLOCK_CEILING_MS = 2_000;

export type ExactEndgameBudget = {
  readonly maxNodes: number;
  /** Overridable for tests; production dispatch uses the shared decision deadline. */
  readonly maxWallClockMs?: number;
};

export type ExactEndgameResult = {
  readonly candidates: readonly ReviewCandidateEvaluationV1[];
  readonly best: ReviewCandidateEvaluationV1;
  readonly nodes: number;
  readonly hiddenStateSamples: number;
  readonly coverage: number;
  readonly complete: boolean;
};

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

function buildRootState(
  snapshot: ReviewPositionSnapshotV2,
  opponentHand: readonly Tile[],
  deadTiles: readonly Tile[],
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
    // B2 is scoped strictly to a locked yard (guarded below), so the
    // drawable boneyard is always empty; every remaining hidden tile is dead.
    boneyard: [],
    deadTiles,
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

/**
 * B2 (game-review-oracle-upgrade-2026-09-13.md): exact, exhaustive endgame
 * solver. Scoped strictly to a locked yard (`boneyard.drawableCount === 0`)
 * -- the only place a fully exhaustive search over both the hidden opponent
 * hand and the rest of the game is tractable, because no further draws can
 * ever change the pool of tiles in play. Enumerates every
 * knownMissingPipEvidence-consistent opponent-hand allocation exactly once
 * (fixed lexicographic order over canonically-sorted tiles), then for each
 * of the actor's `legalActions` runs a node-budgeted, exhaustive minimax to
 * the hand's actual end (not a heuristic cutoff) under that allocation, and
 * averages the resulting point differential across every allocation that
 * was solved.
 *
 * Two decisions this file makes without further prose in the design doc,
 * called out per the project's "flag it, don't silently smooth over"
 * convention:
 *  - Allocations are the outer loop, actions the inner loop: for a given
 *    allocation, every legal action is searched before moving to the next
 *    allocation, and an allocation only counts toward `hiddenStateSamples`
 *    if ALL actions finished under budget for it. This keeps every
 *    candidate's average computed over the exact same set of allocations,
 *    so candidates stay fairly comparable even when the budget cuts the
 *    enumeration short (see also `nodes`' cap discussed above).
 *  - value.expectedPointDifferential is the NET swing from this decision
 *    point (final actor-minus-opponent score differential at hand end,
 *    minus the differential already on the board in `snapshot.preAction`),
 *    not the raw final differential -- more directly answers "how good is
 *    this specific decision".
 *  - principalVariation is left empty, as in B0/B1's stubs: B2's design doc
 *    never asked for a recorded best-line, and fabricating one from the
 *    minimax without actually threading it through would misrepresent what
 *    was computed.
 */
export function solveExactEndgame(
  snapshot: ReviewPositionSnapshotV2,
  budget: ExactEndgameBudget,
  maxPips = 6,
  // Injectable for deterministic wall-clock tests; production callers omit.
  now: () => number = Date.now,
  shouldStop?: () => boolean,
): ExactEndgameResult | null {
  if (snapshot.preAction.boneyard.drawableCount !== 0) {
    throw new Error(
      'solveExactEndgame: out of scope -- this solver only handles a locked yard ' +
        '(boneyard.drawableCount === 0); a nonzero drawable count is a scope-boundary ' +
        'violation, not a runtime infeasibility.',
    );
  }

  const { actorId, opponentId } = snapshot.identifiers;
  const { opponentTileCount, scores, board } = snapshot.preAction;
  const rootDiff = scores.actor - scores.opponent;

  const { eligibleForOpponent, excludedTiles } = resolveHiddenPoolEligibility(snapshot, maxPips);
  const canonicalEligible = sortTilesCanonically(eligibleForOpponent);
  // Closed-form nCr — do not eagerly materialize allocations (that cost is
  // itself what the wall-clock ceiling must be able to interrupt).
  const totalAllocationCount = countCombinations(canonicalEligible.length, opponentTileCount);

  if (totalAllocationCount === 0) return null;

  const config: Config = { ...DEFAULT_CONFIG, maxPips, winningScore: snapshot.preAction.winningTarget };
  const nodeBudget = { count: 0, max: budget.maxNodes };
  const wallClockCeilingMs = budget.maxWallClockMs ?? EXACT_ENDGAME_DEFAULT_WALL_CLOCK_CEILING_MS;
  const startedAt = now();

  // Exhaustive to the hand's real end -- no depth cutoff, only the shared
  // node budget and true terminal states end a branch.
  const walkConfig: GameTreeWalkConfig = {
    shouldStop,
    actorId,
    opponentId,
    isCutoff: (state) => state.handOver || state.gameOver,
    leafValue: (state) => state.players[actorId].score - state.players[opponentId].score,
  };

  const totals = snapshot.legalActions.map(() => 0);
  let solvedAllocations = 0;
  let wallClockExceeded = false;

  for (const allocation of enumerateCombinationsLazy(canonicalEligible, opponentTileCount)) {
    // Bound enumeration itself (not only tree walk) to the ceiling.
    if (shouldStop?.() || now() - startedAt > wallClockCeilingMs) {
      wallClockExceeded = true;
      break;
    }

    const leftover = canonicalEligible.filter((tile) => !allocation.some((chosen) => tileEquals(chosen, tile)));
    const deadTiles = [...leftover, ...excludedTiles];

    const perActionDiffs: number[] = [];
    let allocationComplete = true;

    for (const action of snapshot.legalActions) {
      const rootState = buildRootState(snapshot, allocation, deadTiles, config);
      const command = commandForAction(rootState, actorId, action);
      const { state: postActionState } = applyGameCommand(rootState, command);
      const { finished, diff } = searchGameTree(postActionState, 0, walkConfig, nodeBudget);
      perActionDiffs.push(diff - rootDiff);
      if (!finished) allocationComplete = false;
    }

    // Incomplete allocation is discarded so every counted sample covers all
    // actions — timeout mid-allocation never silently re-ranks candidates.
    if (!allocationComplete) break;

    perActionDiffs.forEach((diff, index) => {
      totals[index] += diff;
    });
    solvedAllocations += 1;
  }

  const complete = !wallClockExceeded && solvedAllocations === totalAllocationCount;
  const coverage = solvedAllocations / totalAllocationCount;

  const candidates: ReviewCandidateEvaluationV1[] = snapshot.legalActions.map((action, index) => ({
    action,
    value: {
      expectedPointDifferential: solvedAllocations > 0 ? totals[index] / solvedAllocations : 0,
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

  return {
    candidates,
    best: candidates[0],
    nodes: nodeBudget.count,
    hiddenStateSamples: solvedAllocations,
    coverage,
    complete,
  };
}
