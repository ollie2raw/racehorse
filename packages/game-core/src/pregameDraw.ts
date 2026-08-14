import type { Tile } from './types';

export function tilePipSum(tile: Tile): number {
  return tile.low + tile.high;
}

export function generateDoubleSixSet(): Tile[] {
  const tiles: Tile[] = [];
  for (let high = 0; high <= 6; high++) {
    for (let low = 0; low <= high; low++) {
      tiles.push({ low, high });
    }
  }
  return tiles;
}

export function shuffleTiles(deck: readonly Tile[], rng: () => number = Math.random): Tile[] {
  const out = deck.map((tile) => ({ low: tile.low, high: tile.high }));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Compare draw tiles by total pip value, then by the higher individual pip. */
export function comparePregameDrawTiles(a: Tile, b: Tile): number {
  const sumDifference = tilePipSum(a) - tilePipSum(b);
  if (sumDifference !== 0) return sumDifference;
  return Math.max(a.low, a.high) - Math.max(b.low, b.high);
}
