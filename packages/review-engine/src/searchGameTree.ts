import { applyGameCommand, canDraw, getLegalMoves, type GameCommand, type GameState } from '@racehorse/game-core';
import { GAME_COMMAND_VERSION } from '@racehorse/game-core';
import type { ReviewAction } from '@racehorse/game-core/review';

export type NodeBudget = { count: number; readonly max: number };

export type GameTreeWalkOutcome = {
  readonly finished: boolean;
  readonly diff: number;
};

export type GameTreeWalkConfig = {
  readonly actorId: string;
  readonly opponentId: string;
  /** Depth is the number of plies already walked from the search's root (0 at the root). */
  readonly isCutoff: (state: GameState, depth: number) => boolean;
  readonly leafValue: (state: GameState) => number;
};

export function commandForAction(state: GameState, actorId: string, action: ReviewAction): GameCommand {
  const base = {
    version: GAME_COMMAND_VERSION,
    commandId: `search-game-tree:${state.sequence}`,
    sequence: state.sequence,
    actorId,
  } as const;
  if (action.kind === 'play') return { ...base, kind: 'play', tile: action.tile, position: action.position };
  if (action.kind === 'draw') return { ...base, kind: 'draw' };
  return { ...base, kind: 'pass' };
}

/**
 * Shared by B2's solveExactEndgame (exhaustive-to-terminal, no depth limit)
 * and B3's solveMidgameDeterminization (bounded-ply expectimax): a
 * node-budgeted, two-player minimax walk over a fully known GameState.
 * `config.actorId` is always the reviewed player regardless of whose turn it
 * currently is, so the returned `diff` is always in reviewed-player-minus-
 * opponent terms: the reviewed player's moves pick the max, the opponent's
 * moves pick the min.
 *
 * Budget is a hard cap shared across the whole call (every sibling call
 * mutates the same `budget` object): a node whose visit would push
 * `budget.count` past `budget.max` is never counted and is treated as a
 * cutoff (its value falls back to `config.leafValue`, i.e. "assume no
 * further points from here"), so `budget.count` can equal but never exceed
 * `budget.max`.
 *
 * `getLegalMoves` returns an empty array (not a pass, not a draw) whenever
 * the current player has no legal play and the drawable boneyard is
 * nonempty -- drawing is a separate action gated by `canDraw`, and each
 * `'draw'` command draws exactly one tile, so a forced-draw chain needs a
 * loop here rather than a single command. Every individual draw is budgeted
 * exactly like any other visited position (checked before each draw, not
 * just once per call), so a long forced-draw chain can't exceed `maxNodes`
 * uncounted.
 */
export function searchGameTree(
  state: GameState,
  depth: number,
  config: GameTreeWalkConfig,
  budget: NodeBudget,
): GameTreeWalkOutcome {
  if (budget.count >= budget.max) {
    return { finished: false, diff: config.leafValue(state) };
  }
  budget.count += 1;

  let current = state;
  while (canDraw(current, current.playerIds[current.currentPlayerIndex])) {
    if (budget.count >= budget.max) {
      return { finished: false, diff: config.leafValue(current) };
    }
    const drawerId = current.playerIds[current.currentPlayerIndex];
    const drawCommand = commandForAction(current, drawerId, { kind: 'draw' });
    current = applyGameCommand(current, drawCommand).state;
    budget.count += 1;
  }

  if (config.isCutoff(current, depth)) {
    return { finished: true, diff: config.leafValue(current) };
  }

  const currentId = current.playerIds[current.currentPlayerIndex];
  const moves = getLegalMoves(current, currentId);
  const isActorTurn = currentId === config.actorId;

  let finished = true;
  let chosen: number | null = null;

  for (const move of moves) {
    const action: ReviewAction =
      move.type === 'play' ? { kind: 'play', tile: move.tile, position: move.position } : { kind: 'pass' };
    const command = commandForAction(current, currentId, action);
    const { state: nextState } = applyGameCommand(current, command);
    const child = searchGameTree(nextState, depth + 1, config, budget);

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

  return { finished, diff: chosen ?? config.leafValue(current) };
}
