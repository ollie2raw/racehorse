export { evaluateReviewPosition, DEFAULT_REVIEW_WALL_CLOCK_CEILING_MS, WALL_CLOCK_CEILING_DIAGNOSTIC } from './evaluateReviewPosition';
export type { ReviewDispatchBudget, ReviewSearchBudget } from './evaluateReviewPosition';
export {
  completeReviewEvaluations,
  COMPLETION_REVIEW_DISPATCH_BUDGET,
  COMPLETION_REVIEW_COVERAGE_THRESHOLD,
  SEARCH_ESCALATION_TIERS,
  ADAPTIVE_COVERAGE_THRESHOLD,
} from './completeReviewEvaluations';
export type {
  CompleteReviewEvaluationsInput,
  CompleteReviewEvaluationsResult,
} from './completeReviewEvaluations';
export {
  adaptiveEvaluateReviewPosition,
} from './adaptiveEvaluateReviewPosition';
export type { AdaptiveEvaluateResult } from './adaptiveEvaluateReviewPosition';
export {
  finalizeReviewEvaluations,
  needsCompletionReevaluation,
  isEvaluationUnavailable,
  markEvaluationUnavailable,
  annotateLiveEvaluation,
  decisionLifecycle,
} from './finalizeReviewEvaluations';
export type {
  FinalizeReviewEvaluationsInput,
  FinalizeReviewEvaluationsResult,
} from './finalizeReviewEvaluations';
export { resolveFeasibleEvidence, snapshotWithFeasibleEvidence } from './evidenceFeasibility';
export type { EvidenceFeasibilityResolution } from './evidenceFeasibility';
export {
  resolveCausalEvidence,
  snapshotWithCausalEvidence,
} from './evidenceLifecycle';
export type {
  EvidenceLifecycleResolution,
  EvidenceInvalidation,
  EvidenceInvalidationReason,
} from './evidenceLifecycle';
export {
  decideSearchConvergence,
  EVALUATION_STABILITY_EPSILON,
  MIN_SAMPLES_FOR_STABILITY,
  COVERAGE_DIAGNOSTIC_THRESHOLD,
} from './evaluationConvergence';
export type { ConvergenceDecision, ConvergenceAcceptReason } from './evaluationConvergence';
export {
  assertLifecycleTransition,
  isAllowedLifecycleTransition,
  transitionLifecycle,
  mayEnterFailedFatal,
  DECISION_LIFECYCLE_TERMINALS,
} from './decisionLifecycleStateMachine';
export {
  InMemoryCheckpointStore,
  createReviewCompletionJob,
  runReviewCompletionPass,
  jobAuthoritativeComplete,
  finalArtifactFromJob,
  reviewCompletionJobId,
} from './durableReviewCompletionRuntime';
export { SqlSemanticsCheckpointStore } from './durableSqlSemanticsCheckpointStore';
export type {
  CheckpointStore,
  ReviewCompletionJobRecord,
  ReviewCompletionDecisionCheckpoint,
  RunCompletionPassOptions,
  RunCompletionPassResult,
} from './durableReviewCompletionRuntime';
export {
  CERTIFIED_PRODUCTION_COMPLETION_CONFIG,
  REVIEW_COMPLETION_LEASE_MS,
  REVIEW_COMPLETION_SWEEP_INTERVAL_MS,
  REVIEW_COMPLETION_BACKOFF_BASE_MS,
  REVIEW_COMPLETION_BACKOFF_CAP_MS,
  REVIEW_COMPLETION_DECISION_CONCURRENCY,
} from './productionCompletionConfig';
export type { CertifiedProductionCompletionConfig } from './productionCompletionConfig';
export {
  EXACT_ENUMERATION_STATE_SPACE_THRESHOLD,
  PROGRESSIVE_CHUNK_SAMPLES,
  PROGRESSIVE_CHUNK_NODES,
  PROGRESSIVE_CHUNK_WALL_MS,
  PROGRESSIVE_MAX_CHUNKS_PER_PASS,
} from './adaptiveEvaluateReviewPosition';
export { computePublicPositionHash } from './publicPositionHash';
export { sampleHiddenAllocation } from './sampleHiddenAllocation';
export type { ReviewHiddenAllocation } from './sampleHiddenAllocation';
export { resolveHiddenPoolEligibility } from './hiddenPoolEligibility';
export type { ReviewHiddenPoolEligibility } from './hiddenPoolEligibility';
export { solveExactEndgame, EXACT_ENDGAME_DEFAULT_WALL_CLOCK_CEILING_MS } from './solveExactEndgame';
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
// E2 (game-review-oracle-upgrade-2026-09-13.md Phase E): relocated from
// client/src/analyzer/ so the server can compute the identical
// accuracy/grade result the client asserts, for reconciliation.
export { gradeFromAccuracy } from './accuracyGrade';
export { computeGameAccuracyModel, MINIMUM_COVERAGE_FLOOR } from './gameAccuracyModel';
export type { GameAccuracyModelResult } from './gameAccuracyModel';
export {
  serializeReviewCaptureRecordsToJsonl,
  deserializeReviewCaptureRecordsFromJsonl,
} from './reviewCaptureSchema';
// Positional features (feat/review-positional-features): tier-agnostic,
// named numeric features over a single candidate action, ported from
// client/src/modules/fritz/botHeuristics.ts via solveHeuristicOpening.ts's
// already-exported pure functions -- see computePositionalFeatures.ts.
export { computePositionalFeatures, POSITIONAL_FEATURE_NAMES } from './computePositionalFeatures';
export type { PositionalFeatures, PositionalFeatureName } from './computePositionalFeatures';
export type {
  ReviewCaptureBatchTag,
  ReviewCaptureCorpusKind,
  ReviewCaptureRecord,
  ReviewCaptureManifest,
} from './reviewCaptureSchema';
