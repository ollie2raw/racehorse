import type { GameState, Tile } from '../types';
import { tileEquals } from '../game/tileUtils';

export function tileListEquals(a: Tile[], b: Tile[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!tileEquals(a[i], b[i])) return false;
  }
  return true;
}

export function getBoardEnds(board: GameState['board'] | null | undefined): [number, number] {
  if (!board) return [-1, -1];
  return [board.leftEnd, board.rightEnd];
}

export function getBoardTileCount(board: GameState['board']): number {
  if (!board) return 0;
  let count = board.mainLine?.length ?? 0;
  for (const hub of board.hubDoubles ?? []) {
    for (const arm of hub?.branches ?? []) {
      if (arm?.tiles?.length) count += arm.tiles.length;
    }
  }
  return count;
}

function getBoardTiles(board: GameState['board']): Tile[] {
  if (!board) return [];
  const tiles: Tile[] = [];
  for (const placed of board.mainLine ?? []) {
    if (!placed?.tile) continue;
    tiles.push(placed.tile);
  }
  for (const hub of board.hubDoubles ?? []) {
    for (const branch of hub?.branches ?? []) {
      if (!branch?.tiles) continue;
      for (const placed of branch.tiles) {
        if (!placed?.tile) continue;
        tiles.push(placed.tile);
      }
    }
  }
  return tiles;
}

function tileKey(tile: Tile): string {
  const low = Math.min(tile.low, tile.high);
  const high = Math.max(tile.low, tile.high);
  return `${low}-${high}`;
}

export function findPlacedTile(
  previousBoard: GameState['board'],
  nextBoard: GameState['board'],
): Tile | null {
  const prevCounts = new Map<string, number>();
  for (const tile of getBoardTiles(previousBoard)) {
    const key = tileKey(tile);
    prevCounts.set(key, (prevCounts.get(key) ?? 0) + 1);
  }
  for (const tile of getBoardTiles(nextBoard)) {
    const key = tileKey(tile);
    const prevCount = prevCounts.get(key) ?? 0;
    if (prevCount <= 0) return tile;
    prevCounts.set(key, prevCount - 1);
  }
  return null;
}
