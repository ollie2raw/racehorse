/**
 * Tile utility functions — pure game domain helpers.
 * No React, no state, no side effects.
 */

import type { Move, Tile } from '../types';

/**
 * Returns true if two tiles represent the same domino,
 * regardless of which end is high or low.
 * Order-insensitive: tileEquals({high:3,low:5}, {high:5,low:3}) === true
 */
export function tileEquals(a: Tile, b: Tile): boolean {
  return (a.high === b.high && a.low === b.low) ||
         (a.high === b.low  && a.low === b.high);
}

/**
 * Tile utility functions — continued
 */

export function buildDoubleSixTiles(): Tile[] {
  const tiles: Tile[] = [];
  for (let high = 0; high <= 6; high += 1) {
    for (let low = 0; low <= high; low += 1) {
      tiles.push({ low, high });
    }
  }
  return tiles;
}

export function sumTilePips(hand: Tile[]): number {
  return hand.reduce((sum, tile) => sum + tile.low + tile.high, 0);
}

export function findMoveForSelection(moves: Move[], tile: Tile, position: Move['position']): Move | null {
  return (
    moves.find(
      (m) => m.type === 'play' && m.tile && m.position === position && tileEquals(m.tile, tile),
    ) ?? null
  );
}

export function asPlayMoves(moves: Move[]): Move[] {
  return moves.filter((m) => m.type === 'play');
}
