import type { Tile } from '../../../types.ts';

export function computeNormalHandRows(
  tiles: Tile[],
  options: {
    isLessonLayoutMode: boolean;
    lessonHandRowCount: number;
    isMobileViewport: boolean;
  },
): Tile[][] {
  const { isLessonLayoutMode, lessonHandRowCount, isMobileViewport } = options;
  if (isLessonLayoutMode) {
    if (lessonHandRowCount <= 1 || tiles.length <= 1) return [tiles];
    const midpoint = Math.ceil(tiles.length / 2);
    return [tiles.slice(0, midpoint), tiles.slice(midpoint)];
  }
  if (tiles.length > 9) {
    if (isMobileViewport && tiles.length === 7) {
      return [tiles.slice(0, 4), tiles.slice(4)];
    }
    const midpoint = Math.ceil(tiles.length / 2);
    return [tiles.slice(0, midpoint), tiles.slice(midpoint)];
  }
  return [tiles];
}