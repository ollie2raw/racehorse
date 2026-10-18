import type { Tile } from '../../../types.ts';

export function computeNormalHandRows(
  tiles: Tile[],
  options: {
    isLessonLayoutMode: boolean;
    lessonHandRowCount: number;
    isMobileViewport: boolean;
    /** Short, wide viewport (phone landscape): 9 tiles at full size overflow, so split from 9. */
    isShortLandscape?: boolean;
    /** Compact landscape (<844px wide): most tiles that fit one row, measured from the deck. Overrides the fixed 8/9 limit. */
    maxSingleRow?: number;
  },
): Tile[][] {
  const { isLessonLayoutMode, lessonHandRowCount, isMobileViewport, isShortLandscape = false, maxSingleRow } = options;
  if (isLessonLayoutMode) {
    if (lessonHandRowCount <= 1 || tiles.length <= 1) return [tiles];
    const midpoint = Math.ceil(tiles.length / 2);
    return [tiles.slice(0, midpoint), tiles.slice(midpoint)];
  }
  if (tiles.length > (maxSingleRow ?? (isShortLandscape ? 8 : 9))) {
    if (isMobileViewport && tiles.length === 7) {
      return [tiles.slice(0, 4), tiles.slice(4)];
    }
    const midpoint = Math.ceil(tiles.length / 2);
    return [tiles.slice(0, midpoint), tiles.slice(midpoint)];
  }
  return [tiles];
}