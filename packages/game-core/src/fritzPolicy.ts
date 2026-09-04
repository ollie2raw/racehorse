import { canDraw, getLegalMoves } from './engine';
import { branchHasPlayableTiles, hubIdAt } from './openEndsGeometry';
import { createDeterministicRandom } from './random';
import { computeOpenEndsSum, computePlayScore, getOpenEnds, simulatePlacement } from './scoring';
import type { GameState, Move, PlacementPosition, Tile } from './types';
import { tileEquals } from './types';

/**
 * Bumped when official Fritz selection/scoring semantics change (deterministic
 * ties, empty-arm collapse).
 *
 * v3 (GC-6, HARDENING_PLAN §7.3): the strategic-score tie-break switched from
 * `String.localeCompare` — which has no locale argument and is therefore
 * host/locale-dependent, so the "deterministic canonical ties" of v2 were not
 * actually runtime-deterministic — to a pure UTF-16 code-unit comparison. The
 * top-scoring set is unchanged, so `FRITZ_POLICY_MIN_SUPPORTED_VERSION` stays 1
 * and every historical v1/v2 transcript still verifies (the verifier accepts any
 * top-score play). The bump is the record of the behaviour change, per the
 * project's policy-versioning standard.
 */
export const FRITZ_POLICY_VERSION = 3 as const;
/** Oldest policy version the verifier still accepts on historical transcripts. */
export const FRITZ_POLICY_MIN_SUPPORTED_VERSION = 1 as const;
export type FritzPolicyVersion = 1 | 2 | 3;
export const FRITZ_POLICY_CONTRACTS = {
  1: 'fritz-policy-v1-seeded-top-score',
  2: 'fritz-policy-v2-deterministic-canonical-ties',
  3: 'fritz-policy-v3-code-unit-canonical-ties',
} as const satisfies Record<FritzPolicyVersion, string>;

/**
 * Total order on strings by UTF-16 code unit — the comparison `Array#sort` uses
 * by default, and (unlike `localeCompare`) identical on every JS engine and
 * under every host locale. GC-6: the Fritz strategic-score tie-break MUST use
 * this, never `localeCompare`.
 */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
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
    .sort((left, right) =>
      right.score - left.score
      || compareCodeUnits(canonicalMoveKey(left.move), canonicalMoveKey(right.move)));
}

export function getFritzPolicyContract(version: FritzPolicyVersion): string {
  return FRITZ_POLICY_CONTRACTS[version];
}

export function isSupportedFritzPolicyVersion(value: unknown): value is FritzPolicyVersion {
  return value === 1 || value === 2 || value === 3;
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

export function isOptimalOfficialFritzPlayForVersion(input: {
  version: FritzPolicyVersion;
  state: GameState;
  participantId: string;
  tier: FritzTier;
  tile: Tile;
  position: PlacementPosition;
}): boolean {
  // Policy v1, v2 and v3 use the same integer strategic score. V2 changed tie
  // selection + symmetric empty-arm canonicalization; v3 (GC-6) changed only the
  // tie-break comparator (`localeCompare` → code-unit). None changed what counts
  // as a top-scoring play, so historical v1/v2 evidence verifies against the
  // version-agnostic checker.
  return isOptimalOfficialFritzPlay(input);
}

export function chooseOfficialFritzDecisionForVersion(input: {
  version: FritzPolicyVersion;
  state: GameState;
  participantId: string;
  tier: FritzTier;
}): FritzDecision {
  const legalPlays = getLegalMoves(input.state, input.participantId)
    .filter((move): move is PlayMove => move.type === 'play');
  if (legalPlays.length === 0) {
    return canDraw(input.state, input.participantId) ? { kind: 'draw' } : { kind: 'pass' };
  }
  if (input.version === 1) {
    const scored = scoreSortedPlays(input.state, input.participantId, input.tier, legalPlays);
    const topScore = scored[0].score;
    const tied = scored.filter((entry) => entry.score === topScore);
    const selected = tied[
      createDeterministicRandom(getOfficialFritzDecisionSeed(input.state)).nextInt(tied.length)
    ].move;
    return { kind: 'play', tile: selected.tile, position: selected.position };
  }
  // v2 and v3: identical selection (collapse symmetric empty arms, then take the
  // canonical top-scoring play). v3's tie-break comparator is code-unit; a v2
  // transcript replayed here therefore resolves the same way, and the verifier
  // accepts any top-score play regardless.
  const plays = collapseSymmetricEmptyBranchPlays(input.state, legalPlays);
  const scored = scoreSortedPlays(input.state, input.participantId, input.tier, plays);
  const selected = scored[0].move;
  return { kind: 'play', tile: selected.tile, position: selected.position };
}

export function chooseOfficialFritzDecision(input: {
  state: GameState;
  participantId: string;
  tier: FritzTier;
}): FritzDecision {
  return chooseOfficialFritzDecisionForVersion({
    version: FRITZ_POLICY_VERSION,
    ...input,
  });
}
