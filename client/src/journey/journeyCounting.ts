import { buildDoubleSixTiles } from '../game/tileUtils.ts';
import type { BoardState, Tile } from '../types.ts';
import { canonicalJourneyTileId, collectPhysicalTilesFromBoard } from './journeyBoardAnalysis.ts';

export function canonicalTileId(tile: Tile): string {
  return canonicalJourneyTileId(tile);
}

export function getCoreJourneyTileSet(): Tile[] {
  return buildDoubleSixTiles();
}

export function getTilesContainingPip(tileSet: readonly Tile[], pip: number): Tile[] {
  validateTileSet(tileSet);
  validatePip(tileSet, pip);
  return tileSet.filter((tile) => tile.low === pip || tile.high === pip).map((tile) => ({ ...tile }));
}

export function getAccountedTilesForPip({ tileSet, board, playerHand, pip }: { tileSet: readonly Tile[]; board: BoardState; playerHand: readonly Tile[]; pip: number }): Tile[] {
  validateKnownTiles(tileSet, board, playerHand);
  validatePip(tileSet, pip);
  const known = [...collectPhysicalTilesFromBoard(board), ...playerHand];
  const ids = new Set<string>();
  return known.filter((tile) => {
    if (tile.low !== pip && tile.high !== pip) return false;
    const id = canonicalTileId(tile);
    if (ids.has(id)) return false;
    ids.add(id);
    return true;
  }).map((tile) => ({ ...tile }));
}

export function getUnseenTilesForPip(input: { tileSet: readonly Tile[]; board: BoardState; playerHand: readonly Tile[]; pip: number }): Tile[] {
  const containing = getTilesContainingPip(input.tileSet, input.pip);
  const accounted = new Set(getAccountedTilesForPip(input).map(canonicalTileId));
  return containing.filter((tile) => !accounted.has(canonicalTileId(tile))).map((tile) => ({ ...tile }));
}

export function getUnseenTileCountForPip(input: { tileSet: readonly Tile[]; board: BoardState; playerHand: readonly Tile[]; pip: number }): number {
  return getUnseenTilesForPip(input).length;
}

export function validateKnownTiles(tileSet: readonly Tile[], board: BoardState, playerHand: readonly Tile[]): void {
  validateTileSet(tileSet);
  const valid = new Set(tileSet.map(canonicalTileId));
  const seen = new Set<string>();
  const known = [...collectPhysicalTilesFromBoard(board), ...playerHand];
  for (const tile of known) {
    const id = canonicalTileId(tile);
    if (!valid.has(id)) throw new Error(`Known tile ${id} is outside the active ruleset.`);
    if (seen.has(id)) throw new Error(`Duplicate physical tile ${id} is present in known information.`);
    seen.add(id);
  }
}

function validateTileSet(tileSet: readonly Tile[]): void {
  const ids = new Set<string>();
  for (const tile of tileSet) {
    const id = canonicalTileId(tile);
    if (ids.has(id)) throw new Error(`Duplicate physical tile ${id} in ruleset.`);
    ids.add(id);
  }
}

function validatePip(tileSet: readonly Tile[], pip: number): void {
  if (!Number.isInteger(pip) || pip < 0 || !tileSet.some((tile) => tile.low === pip || tile.high === pip)) {
    throw new Error(`Invalid pip ${pip}.`);
  }
}
