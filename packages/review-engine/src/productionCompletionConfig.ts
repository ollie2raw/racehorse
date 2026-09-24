/**
 * Production completion configuration — certified fixture.
 * CI fails if SEARCH_ESCALATION_TIERS / lease / sweep diverge without updating this file.
 */
import {
  SEARCH_ESCALATION_TIERS,
  EXACT_ENUMERATION_STATE_SPACE_THRESHOLD,
  PROGRESSIVE_CHUNK_SAMPLES,
  PROGRESSIVE_CHUNK_NODES,
  PROGRESSIVE_CHUNK_WALL_MS,
  PROGRESSIVE_MAX_CHUNKS_PER_PASS,
  ADAPTIVE_COVERAGE_THRESHOLD,
} from './adaptiveEvaluateReviewPosition';
import {
  EVALUATION_STABILITY_EPSILON,
  MIN_SAMPLES_FOR_STABILITY,
  COVERAGE_DIAGNOSTIC_THRESHOLD,
} from './evaluationConvergence';
import {
  ACCURACY_MODEL_CALIBRATION_VERSION,
  CALIBRATED_K,
  LOSS_BAND_BOUNDARIES,
} from './accuracyModelCalibration';

/** Worker lease duration for durable claim (ms). */
export const REVIEW_COMPLETION_LEASE_MS = 60_000;

/** Server sweep cadence (ms). */
export const REVIEW_COMPLETION_SWEEP_INTERVAL_MS = 15_000;

/** Bounded backoff base for FAILED_RETRYABLE requeue. */
export const REVIEW_COMPLETION_BACKOFF_BASE_MS = 500;
export const REVIEW_COMPLETION_BACKOFF_CAP_MS = 60_000;

/** Bounded in-pass decision concurrency for durable completion workers. */
export const REVIEW_COMPLETION_DECISION_CONCURRENCY = 4;


export const CERTIFIED_PRODUCTION_COMPLETION_CONFIG = {
  accuracyModelVersion: ACCURACY_MODEL_CALIBRATION_VERSION,
  k: CALIBRATED_K,
  lossBands: {
    best: LOSS_BAND_BOUNDARIES.bestTolerance,
    inaccuracy: LOSS_BAND_BOUNDARIES.inaccuracyToMistake,
    mistake: LOSS_BAND_BOUNDARIES.mistakeToBlunder,
  },
  tiers: SEARCH_ESCALATION_TIERS.map((t) => ({
    tier: t.tier,
    maxNodes: t.budget.maxNodes,
    maxHiddenStateSamples: t.budget.maxHiddenStateSamples,
    maxPlyDepth: t.budget.maxPlyDepth,
    seed: t.budget.seed,
    maxWallClockMs: t.budget.maxWallClockMs,
  })),
  progressive: {
    chunkSamples: PROGRESSIVE_CHUNK_SAMPLES,
    chunkNodes: PROGRESSIVE_CHUNK_NODES,
    chunkWallMs: PROGRESSIVE_CHUNK_WALL_MS,
    maxChunksPerPass: PROGRESSIVE_MAX_CHUNKS_PER_PASS,
  },
  exactEnumerationStateSpaceThreshold: EXACT_ENUMERATION_STATE_SPACE_THRESHOLD,
  convergence: {
    coverageDiagnosticThreshold: COVERAGE_DIAGNOSTIC_THRESHOLD,
    adaptiveCoverageThreshold: ADAPTIVE_COVERAGE_THRESHOLD,
    stabilityEpsilon: EVALUATION_STABILITY_EPSILON,
    minSamplesForStability: MIN_SAMPLES_FOR_STABILITY,
  },
  worker: {
    leaseMs: REVIEW_COMPLETION_LEASE_MS,
    sweepIntervalMs: REVIEW_COMPLETION_SWEEP_INTERVAL_MS,
    backoffBaseMs: REVIEW_COMPLETION_BACKOFF_BASE_MS,
    backoffCapMs: REVIEW_COMPLETION_BACKOFF_CAP_MS,
    decisionConcurrency: REVIEW_COMPLETION_DECISION_CONCURRENCY,
  },
} as const;

export type CertifiedProductionCompletionConfig = typeof CERTIFIED_PRODUCTION_COMPLETION_CONFIG;
