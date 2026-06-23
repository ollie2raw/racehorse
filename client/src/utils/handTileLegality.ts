import type { Tile, Move } from '../types';
import { tileEquals } from '../game/tileUtils';

export function tileMatchesHandTile(a: Tile, b: Tile): boolean {
  return tileEquals(a, b);
}

export function tileKey(tile: Tile): string {
  const low = Math.min(tile.low, tile.high);
  const high = Math.max(tile.low, tile.high);
  return `${low}-${high}`;
}

export function buildPlayableTileKeys(moves: Move[]): Set<string> {
  const keys = new Set<string>();
  for (const move of moves) {
    if (move.type === 'play' && move.tile) {
      keys.add(tileKey(move.tile));
    }
  }
  return keys;
}

export function isPlayableHandTile(tile: Tile, playableKeys: Set<string>): boolean {
  return playableKeys.has(tileKey(tile));
}

export function getHandTileLegality(
  tile: Tile,
  showLegality: boolean,
  playableKeys: Set<string>,
): { highlight: boolean; unplayable: boolean } {
  if (!showLegality) {
    return { highlight: false, unplayable: false };
  }
  const playable = isPlayableHandTile(tile, playableKeys);
  return {
    highlight: playable,
    unplayable: !playable,
  };
}
