import {
  applyGameCommand,
  DEFAULT_CONFIG,
  getLegalMoves,
  computePlayScore,
  simulatePlacement,
  tileEquals,
  type Config,
  type GameCommand,
  type GameState,
  type Tile,
} from '@racehorse/game-core';
import { GAME_COMMAND_VERSION } from '@racehorse/game-core';
import type { ReviewAction, ReviewCandidateEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { enumerateCombinations } from './combinations';
import { resolveHiddenPoolEligibility } from './hiddenPoolEligibility';

export type ExactEndgameBudget = { readonly maxNodes: number };

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

function commandForAction(state: GameState, actorId: string, action: ReviewAction): GameCommand {
  const base = {
    version: GAME_COMMAND_VERSION,
    commandId: `exact-endgame:${state.sequence}`,
    sequence: state.sequence,
    actorId,
  } as const;
  if (action.kind === 'play') return { ...base, kind: 'play', tile: action.tile, position: action.position };
  if (action.kind === 'draw') return { ...base, kind: 'draw' };
  return { ...base, kind: 'pass' };
}

/**
 * Node-budgeted, exhaustive two-player minimax over a fully known GameState
 * (one enumerated hidden-allocation world). `actorId` is always the reviewed
 * player, regardless of whose turn it currently is, so the value returned is
 * always in reviewed-player-minus-opponent terms: the reviewed player's
 * moves pick the max, the opponent's moves pick the min.
 *
 * Budget is a hard cap: a node whose visit would push the shared counter
 * past `budget.max` is never counted and is treated as a cutoff (its value
 * falls back to the score differential already on the board at that point,
 * i.e. "assume no further points from here"), so `budget.count` can equal
 * but never exceed `budget.max`.
 */
function search(
  state: GameState,
  actorId: string,
  opponentId: string,
  budget: { count: number; max: number },
): { finished: boolean; diff: number } {
  const diffAtState = state.players[actorId].score - state.players[opponentId].score;

  if (budget.count >= budget.max) {
    return { finished: false, diff: diffAtState };
  }
  budget.count += 1;

  if (state.handOver || state.gameOver) {
    return { finished: true, diff: diffAtState };
  }

  const currentId = state.playerIds[state.currentPlayerIndex];
  const moves = getLegalMoves(state, currentId);
  const isActorTurn = currentId === actorId;

  let finished = true;
  let chosen: number | null = null;

  for (const move of moves) {
    const action: ReviewAction =
      move.type === 'play' ? { kind: 'play', tile: move.tile, position: move.position } : { kind: 'pass' };
    const command = commandForAction(state, currentId, action);
    const { state: nextState } = applyGameCommand(state, command);
    const child = search(nextState, actorId, opponentId, budget);

    if (!child.finished) finished = false;
    if (chosen === null) {
      chosen = child.diff;
    } else if (isActorTurn) {
      chosen = Math.max(chosen, child.diff);
    } else {
      chosen = Math.min(chosen, child.diff);
    }
    if (!child.finished) break;
  }

  return { finished, diff: chosen ?? diffAtState };
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
  const allocations = enumerateCombinations(canonicalEligible, opponentTileCount);

  if (allocations.length === 0) return null;

  const config: Config = { ...DEFAULT_CONFIG, maxPips, winningScore: snapshot.preAction.winningTarget };
  const nodeBudget = { count: 0, max: budget.maxNodes };

  const totals = snapshot.legalActions.map(() => 0);
  let solvedAllocations = 0;

  for (const allocation of allocations) {
    const leftover = canonicalEligible.filter((tile) => !allocation.some((chosen) => tileEquals(chosen, tile)));
    const deadTiles = [...leftover, ...excludedTiles];

    const perActionDiffs: number[] = [];
    let allocationComplete = true;

    for (const action of snapshot.legalActions) {
      const rootState = buildRootState(snapshot, allocation, deadTiles, config);
      const command = commandForAction(rootState, actorId, action);
      const { state: postActionState } = applyGameCommand(rootState, command);
      const { finished, diff } = search(postActionState, actorId, opponentId, nodeBudget);
      perActionDiffs.push(diff - rootDiff);
      if (!finished) allocationComplete = false;
    }

    if (!allocationComplete) break;

    perActionDiffs.forEach((diff, index) => {
      totals[index] += diff;
    });
    solvedAllocations += 1;
  }

  const complete = solvedAllocations === allocations.length;
  const coverage = solvedAllocations / allocations.length;

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
