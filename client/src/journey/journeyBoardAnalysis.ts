import type { BoardState, PlacedTile, Tile } from '../types.ts';
import { tileEquals } from '../game/tileUtils.ts';

export function canonicalJourneyTileId(tile: Tile): string {
  return `${Math.min(tile.low, tile.high)}-${Math.max(tile.low, tile.high)}`;
}

export function collectPhysicalTilesFromBoard(board: BoardState): Tile[] {
  const collected: Tile[] = [];
  const seen = new Set<string>();
  const add = (placed: PlacedTile) => {
    const id = canonicalJourneyTileId(placed.tile);
    if (seen.has(id)) throw new Error(`Duplicate physical board tile ${id}.`);
    seen.add(id);
    collected.push({ ...placed.tile });
  };
  const visitBranch = (tiles: readonly PlacedTile[]) => tiles.forEach(add);
  board.mainLine.forEach(add);
  for (const hub of board.hubDoubles) {
    for (const branch of hub.branches ?? []) if (branch) visitBranch(branch.tiles);
  }
  return collected;
}

export function removeJourneyTile(hand: readonly Tile[], played: Tile): Tile[] {
  const index = hand.findIndex((tile) => tileEquals(tile, played));
  if (index < 0) return hand.map((tile) => ({ ...tile }));
  return hand.filter((_, candidate) => candidate !== index).map((tile) => ({ ...tile }));
}
