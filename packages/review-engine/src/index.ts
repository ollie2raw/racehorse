export { evaluateReviewPosition } from './evaluateReviewPosition';
export type { ReviewDispatchBudget, ReviewSearchBudget } from './evaluateReviewPosition';
export { sampleHiddenAllocation } from './sampleHiddenAllocation';
export type { ReviewHiddenAllocation } from './sampleHiddenAllocation';
export { resolveHiddenPoolEligibility } from './hiddenPoolEligibility';
export type { ReviewHiddenPoolEligibility } from './hiddenPoolEligibility';
export { solveExactEndgame } from './solveExactEndgame';
export type { ExactEndgameBudget, ExactEndgameResult } from './solveExactEndgame';
export { solveMidgameDeterminization } from './solveMidgameDeterminization';
export type { MidgameConvergence, MidgameDeterminizationResult } from './solveMidgameDeterminization';
export { solveHeuristicOpening } from './solveHeuristicOpening';
export type { HandPhase } from './solveHeuristicOpening';
export { accuracyFromEvaluations, isScorable, ACCURACY_MODEL_VERSION, UNCALIBRATED_DEFAULT_K } from './reviewAccuracy';
export type { AccuracyResult } from './reviewAccuracy';
// C4 (phase-c-accuracy-model-spec.md section 6): the one calibration
// constant a client consumer needs directly -- the §4a loss-band
// boundaries, for client/src/analyzer/gameAccuracyModel.ts's label
// function. `CALIBRATED_K` and `ACCURACY_MODEL_CALIBRATION_VERSION`
// deliberately stay unexported here: reviewAccuracy.ts already folds both
// into its own ACCURACY_MODEL_VERSION / default `k`, so no client consumer
// needs to reach into accuracyModelCalibration.ts directly for those.
export { LOSS_BAND_BOUNDARIES } from './accuracyModelCalibration';
export type { CalibratedLossBandBoundaries } from './accuracyModelCalibration';
export {
  serializeReviewCaptureRecordsToJsonl,
  deserializeReviewCaptureRecordsFromJsonl,
} from './reviewCaptureSchema';
export type {
  ReviewCaptureBatchTag,
  ReviewCaptureCorpusKind,
  ReviewCaptureRecord,
  ReviewCaptureManifest,
} from './reviewCaptureSchema';
