/**
 * Shared 0-100 accuracy -> letter grade mapping. Relocated from
 * client/src/analyzer/accuracyGrade.ts (E2, docs/scoping/
 * game-review-oracle-upgrade-2026-09-13.md Phase E) so the server can reuse
 * the exact same mapping `computeGameAccuracyModel` (gameAccuracyModel.ts,
 * this package) needs -- one source of truth for both the client's
 * legacy-scorer usage (moveAnalyzer.ts) and any server-side reconciliation,
 * not two copies that could drift.
 *
 * No calibration work has been done for grade cutoffs specifically (only
 * `k` and the loss-band boundaries were calibrated,
 * phase-c-accuracy-model-spec.md sections 3-4a) -- reusing this one
 * already-shipped mapping for the calibrated accuracy model's grade (C4) is
 * a documented, non-invented choice, not a coincidence.
 */
export function gradeFromAccuracy(accuracy: number): 'S' | 'A' | 'B' | 'C' | 'D' {
  if (accuracy >= 92) return 'S';
  if (accuracy >= 82) return 'A';
  if (accuracy >= 72) return 'B';
  if (accuracy >= 60) return 'C';
  return 'D';
}
