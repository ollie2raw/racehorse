/**
 * Daily Fritz server verification expects one transcript action per drawn tile.
 * Non-Daily modes keep a single collapsed draw entry for move-log UX.
 */
export function resolveTranscriptDrawLogCount(
  isDailyFritzMode: boolean,
  drawCount: number,
): number {
  if (drawCount <= 0) return 0;
  return isDailyFritzMode ? drawCount : 1;
}
