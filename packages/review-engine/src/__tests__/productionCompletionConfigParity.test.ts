/**
 * Part F — production completion configuration parity.
 * Fails CI if live constants silently diverge from the certified fixture.
 */
import { describe, expect, it } from 'vitest';
import {
  SEARCH_ESCALATION_TIERS,
  EXACT_ENUMERATION_STATE_SPACE_THRESHOLD,
  PROGRESSIVE_CHUNK_SAMPLES,
  PROGRESSIVE_CHUNK_NODES,
  PROGRESSIVE_CHUNK_WALL_MS,
  PROGRESSIVE_MAX_CHUNKS_PER_PASS,
  ADAPTIVE_COVERAGE_THRESHOLD,
} from '../adaptiveEvaluateReviewPosition';
import {
  EVALUATION_STABILITY_EPSILON,
  MIN_SAMPLES_FOR_STABILITY,
  COVERAGE_DIAGNOSTIC_THRESHOLD,
} from '../evaluationConvergence';
import {
  CERTIFIED_PRODUCTION_COMPLETION_CONFIG,
  REVIEW_COMPLETION_LEASE_MS,
  REVIEW_COMPLETION_SWEEP_INTERVAL_MS,
  REVIEW_COMPLETION_BACKOFF_BASE_MS,
  REVIEW_COMPLETION_BACKOFF_CAP_MS,
  REVIEW_COMPLETION_DECISION_CONCURRENCY,
} from '../productionCompletionConfig';
import {
  ACCURACY_MODEL_CALIBRATION_VERSION,
  CALIBRATED_K,
  LOSS_BAND_BOUNDARIES,
} from '../accuracyModelCalibration';

describe('production completion configuration parity', () => {
  it('matches the certified production fixture exactly', () => {
    const live = {
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
    };

    expect(live).toEqual(CERTIFIED_PRODUCTION_COMPLETION_CONFIG);

    // Explicit report surface for ops.
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          mode: 'production-config-parity',
          tier1: live.tiers.find((t) => t.tier === 1),
          tier2: live.tiers.find((t) => t.tier === 2),
          tier3: live.tiers.find((t) => t.tier === 3),
          tier4: live.tiers.find((t) => t.tier === 4),
          progressive: live.progressive,
          exactEnumerationThreshold: live.exactEnumerationStateSpaceThreshold,
          convergence: live.convergence,
          worker: live.worker,
        },
        null,
        2,
      ),
    );
  });
});
