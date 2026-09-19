/**
 * Shared 0-100 accuracy -> letter grade mapping, kept client-side for
 * moveAnalyzer.ts's legacy scorer specifically. Deliberately NOT re-pointed
 * at @racehorse/review-engine's own copy (E2, gameAccuracyModel.ts in that
 * package) even though the two must stay identical: moveAnalyzer.ts is
 * reachable from BotMatchScreen's eager bundle via GameReviewer.tsx's value
 * import of LEGACY_ANALYSIS_DISCLOSURE, so a static import of
 * @racehorse/review-engine from moveAnalyzer.ts pulls that package's entire
 * dependency graph into the eager path and trips check:bot-match-lazy --
 * confirmed empirically while building E2 (the relocation this file's
 * twin, review-engine's own accuracyGrade.ts, was built for). This is a
 * narrow, documented, architecturally-forced exception to E2's "no
 * duplicated logic" goal, not an oversight -- if the cutoffs below ever
 * change, review-engine's accuracyGrade.ts must change identically.
 */
export function gradeFromAccuracy(accuracy: number): 'S' | 'A' | 'B' | 'C' | 'D' {
  if (accuracy >= 92) return 'S';
  if (accuracy >= 82) return 'A';
  if (accuracy >= 72) return 'B';
  if (accuracy >= 60) return 'C';
  return 'D';
}
