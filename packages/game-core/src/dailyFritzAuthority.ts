import type { GameState, Tile } from './types';

export const DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION = 1 as const;

function tileKey(tile: Tile): string {
  return `${Math.min(tile.low, tile.high)}|${Math.max(tile.low, tile.high)}`;
}

function participantIndex(state: GameState, participantId: string | null): number | null {
  if (participantId == null) return null;
  const index = state.playerIds.indexOf(participantId);
  return index >= 0 ? index : null;
}

export function canonicalizeDailyFritzAuthorityState(state: GameState): string {
  const players = state.playerIds.map((id) => ({
    hand: state.players[id].hand.map(tileKey).sort(),
    score: state.players[id].score,
  }));
  const canonical = {
    config: {
      tilesPerPlayer: state.config.tilesPerPlayer,
      deadTileCount: state.config.deadTileCount,
      winningScore: state.config.winningScore,
      skipPregameDraw: state.config.skipPregameDraw,
    },
    players,
    board: state.board,
    boneyard: state.boneyard.map(tileKey),
    deadTiles: state.deadTiles.map(tileKey).sort(),
    currentPlayerIndex: state.currentPlayerIndex,
    handNumber: state.handNumber,
    handOpen: state.handOpen,
    handOver: state.handOver,
    gameOver: state.gameOver,
    winnerIndex: participantIndex(state, state.winnerId),
    consecutivePasses: state.consecutivePasses,
    sequence: state.sequence,
  };
  return JSON.stringify(canonical);
}

/**
 * Deterministic cross-runtime drift detector. This is an integrity fingerprint,
 * not a security boundary; transcript verification remains authoritative.
 */
export function getDailyFritzAuthorityStateDigest(state: GameState): string {
  const serialized = canonicalizeDailyFritzAuthorityState(state);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `df-state-v${DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
