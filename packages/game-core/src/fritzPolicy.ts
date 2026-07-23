import { canDraw, getLegalMoves } from './engine';
import { computeOpenEndsSum, computePlayScore, getOpenEnds, simulatePlacement } from './scoring';
import type { GameState, Move, PlacementPosition, Tile } from './types';
import type { DeterministicRandom } from './random';

export const FRITZ_POLICY_VERSION = 1 as const;
export type FritzTier = 'rookie' | 'standard' | 'elite' | 'master';
export type FritzDecision =
  | { kind: 'play'; tile: Tile; position: PlacementPosition }
  | { kind: 'draw' }
  | { kind: 'pass' };

export function getOfficialFritzDecisionSeed(state: Pick<GameState, 'handNumber' | 'sequence'>): string {
  return `daily-fritz:${state.handNumber}:${state.sequence}`;
}

function canonicalMoveKey(move: Move): string {
  if (move.type === 'pass') return 'pass';
  const low = Math.min(move.tile.low, move.tile.high);
  const high = Math.max(move.tile.low, move.tile.high);
  return `${low}|${high}@${move.position}`;
}

function scoreOfficialMove(state: GameState, participantId: string, move: Move, tier: FritzTier): number {
  if (move.type !== 'play') return Number.NEGATIVE_INFINITY;
  const board = simulatePlacement(state.board, move.tile, move.position);
  const immediate = computePlayScore(board, state.config);
  const openEnds = new Set(getOpenEnds(board).map((end) => end.matchValue));
  const remaining = state.players[participantId].hand.filter(
    (tile) => !(tile.low === move.tile.low && tile.high === move.tile.high),
  );
  const mobility = remaining.filter((tile) => openEnds.has(tile.low) || openEnds.has(tile.high)).length;
  const unload = move.tile.low + move.tile.high;
  const doubleSupport = move.tile.low === move.tile.high
    ? remaining.filter((tile) => tile.low === move.tile.low || tile.high === move.tile.high).length
    : 0;
  const tierWeight = tier === 'master' ? 4 : tier === 'elite' ? 3 : tier === 'standard' ? 2 : 1;
  // Keep pure integer scoring so client (Safari) and server (Node) never diverge on float ties.
  return immediate * 100_000
    + mobility * (8 + tierWeight) * 1_000
    + doubleSupport * 4_000
    + unload * 1_000
    + computeOpenEndsSum(board);
}

export function chooseOfficialFritzDecision(input: {
  state: GameState;
  participantId: string;
  tier: FritzTier;
  random: DeterministicRandom;
}): FritzDecision {
  const legal = getLegalMoves(input.state, input.participantId);
  const plays = legal.filter((move): move is Extract<Move, { type: 'play' }> => move.type === 'play');
  if (plays.length === 0) {
    return canDraw(input.state, input.participantId) ? { kind: 'draw' } : { kind: 'pass' };
  }
  const scored = plays
    .map((move) => ({ move, score: scoreOfficialMove(input.state, input.participantId, move, input.tier) }))
    .sort((left, right) => right.score - left.score || canonicalMoveKey(left.move).localeCompare(canonicalMoveKey(right.move)));
  const topScore = scored[0].score;
  const tied = scored.filter((entry) => entry.score === topScore);
  const selected = tied[input.random.nextInt(tied.length)].move;
  return { kind: 'play', tile: selected.tile, position: selected.position };
}
