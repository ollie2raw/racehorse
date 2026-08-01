/**
 * Canonical Daily Fritz divergence digests (shared client/server replay traces).
 * Test/debug only — not wired into production request paths.
 * Pure JS so the same digest works in Node and the browser bundle.
 */
import type { GameState, Tile } from './types.ts';

function stableTile(tile: Tile): string {
  return `${tile.low}|${tile.high}`;
}

function stableTiles(tiles: readonly Tile[]): string {
  return tiles.map(stableTile).join(',');
}

/** FNV-1a 32-bit hex — stable across Node/browser for equality traces. */
export function digestCanonicalString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Canonical pre/post action state digest for client↔server divergence traces. */
export function digestDailyFritzGameState(state: GameState): string {
  const payload = {
    handNumber: state.handNumber,
    sequence: state.sequence,
    currentPlayer: state.playerIds[state.currentPlayerIndex],
    handOpen: state.handOpen,
    handOver: state.handOver,
    gameOver: state.gameOver,
    consecutivePasses: state.consecutivePasses,
    scores: Object.fromEntries(
      state.playerIds.map((id) => [id, state.players[id]?.score ?? 0]),
    ),
    hands: Object.fromEntries(
      state.playerIds.map((id) => [id, stableTiles(state.players[id]?.hand ?? [])]),
    ),
    boneyard: stableTiles(state.boneyard),
    deadTiles: stableTiles(state.deadTiles),
    board: state.board
      ? {
          leftEnd: state.board.leftEnd,
          rightEnd: state.board.rightEnd,
          mainLine: state.board.mainLine.map((placement) => ({
            tile: stableTile(placement.tile),
            orientation: placement.orientation,
          })),
          hubDoubles: state.board.hubDoubles,
        }
      : null,
  };
  return digestCanonicalString(JSON.stringify(payload));
}

export type DailyFritzDivergenceActionTrace = {
  challengeId: string;
  attemptId: string;
  gameNumber: 1 | 2 | 3;
  handIndex: number;
  actionIndex: number;
  stateSeqBefore: string;
  stateSeqAfter: string;
  expectedActor: string;
  submittedActor: string;
  commandType: string;
  tile: string | null;
  position: string | null;
  preDigest: string;
  postDigest: string;
  tier: string;
  rulesVersion: number;
  protocolVersion: number;
  fritzPolicyVersion: number;
  handOver: boolean;
  selectedFritzMove: string | null;
  candidateFritzMoves: string[];
};

export function formatFritzMoveCandidate(input: {
  tile: Tile;
  position: string;
  score?: number;
}): string {
  const score = typeof input.score === 'number' ? `@${input.score}` : '';
  return `${input.tile.low}|${input.tile.high}@${input.position}${score}`;
}
