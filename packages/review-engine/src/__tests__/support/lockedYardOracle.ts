/**
 * Independent best-move / value oracle for locked-yard positions (shared by the oracle property suite and the integration gate).
 *
 * It does NOT call solveExactEndgame, searchGameTree, resolveHiddenPoolEligibility or combinations.ts. It trusts only the
 * authoritative engine for legal actions and transitions, and uses the ruleset STORED in the snapshot.
 */
import {
  applyGameCommand,
  generateFullSet,
  getLegalMoves,
  GAME_COMMAND_VERSION,
  type GameState,
  type Tile,
} from '@racehorse/game-core';
import type { ReviewAction, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { actionKey } from './reviewIntegrityHarness';

export const tk = (t: Tile): string => `${Math.min(t.low, t.high)}|${Math.max(t.low, t.high)}`;

function boardTiles(board: ReviewPositionSnapshotV2['preAction']['board']): Tile[] {
  if (!board) return [];
  const out: Tile[] = board.mainLine.map((p) => p.tile);
  for (const hub of board.hubDoubles) for (const arm of hub.branches) if (arm) out.push(...arm.tiles.map((p) => p.tile));
  return out;
}

function* combinations<T>(items: readonly T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) { yield [...acc]; return; }
  for (let i = start; i <= items.length - (k - acc.length); i += 1) {
    acc.push(items[i]!);
    yield* combinations(items, k, i + 1, acc);
    acc.pop();
  }
}

const choose = (n: number, k: number): number => {
  let r = 1;
  for (let i = 1; i <= k; i += 1) r = (r * (n - k + i)) / i;
  return Math.round(r);
};

export type Oracle = { values: Map<string, number>; max: number; argmax: Set<string>; allocations: number };

/** Independent evaluation of a locked-yard snapshot, or null when it is too large to enumerate here. */
export function oracleFor(snapshot: ReviewPositionSnapshotV2, limits = { allocations: 150, tiles: 9 }): Oracle | null {
  const { actorId, opponentId, handNumber } = snapshot.identifiers;
  const pre = snapshot.preAction;
  const rules = snapshot.rulesetConfig!;
  const known = new Set<string>([...pre.actorHand, ...boardTiles(pre.board)].map(tk));
  const pool = generateFullSet(rules.maxPips).filter((t) => !known.has(tk(t)));
  const k = pre.opponentTileCount;
  const allocations = choose(pool.length, k);
  if (allocations === 0 || allocations > limits.allocations || pre.actorHand.length + k > limits.tiles) return null;

  const config = {
    maxPips: rules.maxPips, tilesPerPlayer: rules.tilesPerPlayer, deadTileCount: rules.deadTileCount, scoringMultiple: rules.scoringMultiple,
    blockedHandRule: rules.blockedHandRule, endHandBonus: rules.endHandBonus, winningScore: rules.winningScore, skipPregameDraw: rules.skipPregameDraw,
  };
  const rootDiff = pre.scores.actor - pre.scores.opponent;
  const command = (state: GameState, who: string, action: ReviewAction) => ({
    version: GAME_COMMAND_VERSION, commandId: 'oracle', sequence: state.sequence, actorId: who,
    ...(action.kind === 'play' ? { kind: 'play' as const, tile: action.tile, position: action.position } : { kind: action.kind }),
  }) as never;

  const solve = (state: GameState): number => {
    if (state.handOver || state.gameOver) return state.players[actorId]!.score - state.players[opponentId]!.score;
    const who = state.playerIds[state.currentPlayerIndex]!;
    const moves = getLegalMoves(state, who);
    if (moves.length === 0) throw new Error('oracle: locked yard but the mover has no legal action');
    let chosen: number | null = null;
    for (const move of moves) {
      const action: ReviewAction = move.type === 'play' ? { kind: 'play', tile: move.tile, position: move.position } : { kind: 'pass' };
      const v = solve(applyGameCommand(state, command(state, who, action)).state);
      chosen = chosen === null ? v : who === actorId ? Math.max(chosen, v) : Math.min(chosen, v);
    }
    return chosen!;
  };

  const totals = new Map<string, number>(snapshot.legalActions.map((a) => [actionKey(a), 0]));
  for (const alloc of combinations(pool, k)) {
    const allocKeys = new Set(alloc.map(tk));
    const dead = pool.filter((t) => !allocKeys.has(tk(t)));
    for (const action of snapshot.legalActions) {
      const root: GameState = {
        config: config as never,
        playerIds: [actorId, opponentId],
        players: {
          [actorId]: { id: actorId, hand: [...pre.actorHand], score: pre.scores.actor },
          [opponentId]: { id: opponentId, hand: [...alloc], score: pre.scores.opponent },
        },
        board: pre.board, boneyard: [], deadTiles: dead, currentPlayerIndex: 0, handNumber, handOpen: pre.handOpen,
        handOver: false, gameOver: false, winnerId: null, consecutivePasses: pre.consecutivePasses, sequence: 0,
      } as GameState;
      const next = applyGameCommand(root, command(root, actorId, action)).state;
      totals.set(actionKey(action), totals.get(actionKey(action))! + (solve(next) - rootDiff));
    }
  }
  const values = new Map([...totals].map(([key, sum]) => [key, sum / allocations]));
  const max = Math.max(...values.values());
  return { values, max, argmax: new Set([...values].filter(([, v]) => v === max).map(([key]) => key)), allocations };
}
