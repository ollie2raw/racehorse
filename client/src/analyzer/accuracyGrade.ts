/**
 * Shared 0-100 accuracy -> letter grade mapping. Extracted from
 * moveAnalyzer.ts (its original, still-only caller) into its own module so
 * gameAccuracyModel.ts (C4) can reuse it without moveAnalyzer.ts <->
 * gameAccuracyModel.ts becoming a circular import -- moveAnalyzer.ts's
 * `GameAnalysis` type needs `GameAccuracyModelResult` from
 * gameAccuracyModel.ts, and gameAccuracyModel.ts's `computeGameAccuracyModel`
 * needs this grade mapping; this file has no dependency on either.
 *
 * No calibration work has been done for grade cutoffs specifically (only
 * `k` and the loss-band boundaries were calibrated,
 * phase-c-accuracy-model-spec.md sections 3-4a) -- reusing this one
 * already-shipped mapping for the new calibrated accuracy model's grade
 * (C4) is a documented, non-invented choice, not a coincidence.
 */
export function gradeFromAccuracy(accuracy: number): 'S' | 'A' | 'B' | 'C' | 'D' {
  if (accuracy >= 92) return 'S';
  if (accuracy >= 82) return 'A';
  if (accuracy >= 72) return 'B';
  if (accuracy >= 60) return 'C';
  return 'D';
}
