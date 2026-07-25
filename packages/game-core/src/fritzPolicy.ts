import { canDraw, getLegalMoves } from './engine';
import { branchHasPlayableTiles, hubIdAt } from './openEndsGeometry';
import { computeOpenEndsSum, computePlayScore, getOpenEnds, simulatePlacement } from './scoring';
import type { GameState, Move, PlacementPosition, Tile } from './types';
import { tileEquals } from './types';

/** Bumped when official Fritz selection/scoring semantics change (deterministic ties, empty-arm collapse). */
export const FRITZ_POLICY_VERSION = 2 as const;
/** Oldest policy version the verifier still accepts on historical transcripts. */
export const FRITZ_POLICY_MIN_SUPPORTED_VERSION = 1 as const;
export type FritzTier = 'rookie' | 'standard' | 'elite' | 'master';
export type FritzDecision =
  | { kind: 'play'; tile: Tile; position: PlacementPosition }
  | { kind: 'draw' }
  | { kind: 'pass' };

type PlayMove = Extract<Move, { type: 'play' }>;

export function getOfficialFritzDecisionSeed(state: Pick<GameState, 'handNumber' | 'sequence'>): string {
  return `daily-fritz:${state.handNumber}:${state.sequence}`;
}

function canonicalMoveKey(move: Move): string {
  if (move.type === 'pass') return 'pass';
  const low = Math.min(move.tile.low, move.tile.high);
  const high = Math.max(move.tile.low, move.tile.high);
  return `${low}|${high}@${move.position}`;
}

function parseBranchPosition(
  position: PlacementPosition,
): { hubId: number; armIndex: number } | null {
  if (typeof position !== 'string') return null;
  const match = /^branch-(\d+)-([01])$/.exec(position);
  if (!match) return null;
  return { hubId: Number(match[1]), armIndex: Number(match[2]) };
}

function findHub(state: GameState, hubId: number) {
  const board = state.board;
  if (!board) return null;
  const index = board.hubDoubles.findIndex((hub, hubIndex) => hubIdAt(hub, hubIndex) === hubId);
  if (index < 0) return null;
  return board.hubDoubles[index];
}

function isEmptyBranchArm(state: GameState, hubId: number, armIndex: number): boolean {
  const hub = findHub(state, hubId);
  if (!hub) return false;
  return !branchHasPlayableTiles(hub.branches[armIndex]);
}

/**
 * Opening either empty arm of the same crossed hub with the same tile is the same
 * strategic play. Keep only the lower arm so client/server never diverge on ties.
 */
export function collapseSymmetricEmptyBranchPlays(
  state: GameState,
  plays: readonly PlayMove[],
): PlayMove[] {
  const bestArmByKey = new Map<string, PlayMove>();
  for (const play of plays) {
    const branch = parseBranchPosition(play.position);
    if (!branch || !isEmptyBranchArm(state, branch.hubId, branch.armIndex)) {
      const key = `unique:${canonicalMoveKey(play)}`;
      bestArmByKey.set(key, play);
      continue;
    }
    const tileKey = `${Math.min(play.tile.low, play.tile.high)}|${Math.max(play.tile.low, play.tile.high)}`;
    const key = `empty-branch:${branch.hubId}:${tileKey}`;
    const existing = bestArmByKey.get(key);
    if (!existing) {
      bestArmByKey.set(key, play);
      continue;
    }
    const existingBranch = parseBranchPosition(existing.position);
    if (!existingBranch || branch.armIndex < existingBranch.armIndex) {
      bestArmByKey.set(key, play);
    }
  }
  return [...bestArmByKey.values()];
}

/** True when two Fritz plays only differ by which empty sibling arm they open. */
export function areEquivalentEmptyBranchFritzPlays(
  state: GameState,
  left: FritzDecision,
  right: FritzDecision,
): boolean {
  if (left.kind !== 'play' || right.kind !== 'play') return false;
  if (!tileEquals(left.tile, right.tile)) return false;
  if (left.position === right.position) return true;
  const leftBranch = parseBranchPosition(left.position);
  const rightBranch = parseBranchPosition(right.position);
  if (!leftBranch || !rightBranch) return false;
  if (leftBranch.hubId !== rightBranch.hubId) return false;
  if (leftBranch.armIndex === rightBranch.armIndex) return true;
  return (
    isEmptyBranchArm(state, leftBranch.hubId, leftBranch.armIndex)
    && isEmptyBranchArm(state, rightBranch.hubId, rightBranch.armIndex)
  );
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

function scoreSortedPlays(
  state: GameState,
  participantId: string,
  tier: FritzTier,
  plays: readonly PlayMove[],
): Array<{ move: PlayMove; score: number }> {
  return plays
    .map((move) => ({ move, score: scoreOfficialMove(state, participantId, move, tier) }))
    .sort((left, right) => right.score - left.score || canonicalMoveKey(left.move).localeCompare(canonicalMoveKey(right.move)));
}

/**
 * All legal plays that share the top official score (no empty-arm collapse).
 * Used by the verifier so historical RNG / sibling-arm transcripts still pass.
 */
export function listOptimalOfficialFritzPlays(input: {
  state: GameState;
  participantId: string;
  tier: FritzTier;
}): PlayMove[] {
  const plays = getLegalMoves(input.state, input.participantId)
    .filter((move): move is PlayMove => move.type === 'play');
  if (plays.length === 0) return [];
  const scored = scoreSortedPlays(input.state, input.participantId, input.tier, plays);
  const topScore = scored[0].score;
  return scored.filter((entry) => entry.score === topScore).map((entry) => entry.move);
}

export function isOptimalOfficialFritzPlay(input: {
  state: GameState;
  participantId: string;
  tier: FritzTier;
  tile: Tile;
  position: PlacementPosition;
}): boolean {
  return listOptimalOfficialFritzPlays(input).some(
    (move) => tileEquals(move.tile, input.tile) && move.position === input.position,
  );
}

export function chooseOfficialFritzDecision(input: {
  state: GameState;
  participantId: string;
  tier: FritzTier;
}): FritzDecision {
  const legalPlays = getLegalMoves(input.state, input.participantId)
    .filter((move): move is PlayMove => move.type === 'play');
  const plays = collapseSymmetricEmptyBranchPlays(input.state, legalPlays);
  if (plays.length === 0) {
    return canDraw(input.state, input.participantId) ? { kind: 'draw' } : { kind: 'pass' };
  }
  const scored = scoreSortedPlays(input.state, input.participantId, input.tier, plays);
  // Fully deterministic: highest score, then stable canonical move key. No RNG —
  // seed-tied picks previously diverged when candidate set size differed (e.g.
  // empty-arm collapse), producing errors like branch-1-1 vs right at the same seed.
  const selected = scored[0].move;
  return { kind: 'play', tile: selected.tile, position: selected.position };
}
