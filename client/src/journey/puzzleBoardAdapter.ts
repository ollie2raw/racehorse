import type { BoardState, TileOrientation } from '../types';
import type { JourneyPuzzleTile } from './journeyPuzzles';

const STATIC_TILE_ORIENTATION: TileOrientation = 'horizontal-flipped';

export function puzzleToBoardState(
  placedTiles: JourneyPuzzleTile[],
  ends: [number, number],
): BoardState {
  return {
    mainLine: placedTiles.map((tile) => ({
      tile: { high: tile.high, low: tile.low },
      orientation: STATIC_TILE_ORIENTATION,
    })),
    leftEnd: ends[0],
    rightEnd: ends[1],
    leftEndIsDouble: ends[0] === ends[0],
    rightEndIsDouble: false,
    hubDoubles: [],
  };
}
