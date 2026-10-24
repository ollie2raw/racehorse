/**
 * Compact landscape match layout: the supported iPhone range below the 844px layout (iPhone SE/8 at 667, 12 mini at 740-812).
 * One place for the numbers the rack sizing depends on, so the Play-vs-Fritz and multiplayer screens cannot drift apart.
 */

/** Widths below this use the compact rack rules; 844+ keeps the existing layout unchanged. */
export const COMPACT_LANDSCAPE_BELOW_WIDTH = 844;

/** A rack tile is 90px wide zoomed to 0.82 (see native-landscape.css and match-live-theme.css), ~75px, with ~10px gaps. */
const RACK_TILE_WIDTH = 75;
const RACK_TILE_GAP = 10;
/** Layout inset (10px each side) plus deck inset (20px each side). */
const RACK_SIDE_INSET = 60;
/** Fewest tiles per row we will ever allow before wrapping to a second row. */
const MIN_SINGLE_ROW = 5;

/** Most rack tiles that fit one row at this viewport width; undefined outside the compact range (use the existing limits). */
export function compactSingleRowLimit(innerWidth: number, isShortLandscape: boolean): number | undefined {
  if (!isShortLandscape || innerWidth >= COMPACT_LANDSCAPE_BELOW_WIDTH) return undefined;
  const fit = Math.floor((innerWidth - RACK_SIDE_INSET + RACK_TILE_GAP) / (RACK_TILE_WIDTH + RACK_TILE_GAP));
  return Math.max(MIN_SINGLE_ROW, fit);
}
