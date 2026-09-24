import type { MidgameConvergence, MidgameDeterminizationResult } from './solveMidgameDeterminization';
import { LOSS_BAND_BOUNDARIES } from './accuracyModelCalibration';

/**
 * Half the Best→Good loss-band boundary: if played-vs-best loss and best-value
 * are stable within this epsilon across successive sample batches, classification
 * into v5 bands would not materially change. K/bands themselves are untouched.
 */
export const EVALUATION_STABILITY_EPSILON =
  LOSS_BAND_BOUNDARIES.bestTolerance / 2; // ~0.065

/** Minimum samples before stability alone may accept a search result. */
export const MIN_SAMPLES_FOR_STABILITY = 32;

/** Coverage remains a diagnostic sufficiency signal, not the sole gate. */
export const COVERAGE_DIAGNOSTIC_THRESHOLD = 0.02;

export type ConvergenceAcceptReason =
  | 'exact-complete'
  | 'stability-converged'
  | 'exhaustive-coverage'
  | 'coverage-diagnostic'
  | 'not-converged';

export type ConvergenceDecision = {
  readonly accepted: boolean;
  readonly reason: ConvergenceAcceptReason;
  readonly detail: string;
};

/**
 * Principled gate: accept search when the accuracy-model inputs are stable
 * (best-action identity + played-vs-best loss), not merely when an arbitrary
 * fraction of hidden states was sampled.
 */
export function decideSearchConvergence(
  midgame: MidgameDeterminizationResult,
  options?: {
    readonly coverageDiagnosticThreshold?: number;
    readonly stabilityEpsilon?: number;
    readonly minSamples?: number;
  },
): ConvergenceDecision {
  const coverageThreshold = options?.coverageDiagnosticThreshold ?? COVERAGE_DIAGNOSTIC_THRESHOLD;
  const eps = options?.stabilityEpsilon ?? EVALUATION_STABILITY_EPSILON;
  const minSamples = options?.minSamples ?? MIN_SAMPLES_FOR_STABILITY;
  const c = midgame.convergence;

  if (midgame.complete && midgame.coverage >= 1 - 1e-12) {
    return {
      accepted: true,
      reason: 'exhaustive-coverage',
      detail: `enumerated coverage=${midgame.coverage}`,
    };
  }

  const stable =
    midgame.hiddenStateSamples >= minSamples
    && c.sameTopAction
    && c.rankingStable
    && c.lossDelta <= eps
    && c.valueDelta <= eps;

  if (stable) {
    return {
      accepted: true,
      reason: 'stability-converged',
      detail:
        `samples=${c.sampleCount} lossDelta=${c.lossDelta.toFixed(4)} `
        + `valueDelta=${c.valueDelta.toFixed(4)} eps=${eps}`,
    };
  }

  // Secondary diagnostic: coverage helps, but best-action identity must also
  // be stable across the halfway checkpoint — coverage alone is not enough.
  if (
    midgame.coverage >= coverageThreshold
    && midgame.hiddenStateSamples >= 8
    && c.sameTopAction
  ) {
    return {
      accepted: true,
      reason: 'coverage-diagnostic',
      detail:
        `coverage=${midgame.coverage.toFixed(4)} sameTop=true `
        + `lossDelta=${c.lossDelta.toFixed(4)}`,
    };
  }

  // Higher coverage without full loss stability still accepts when ranking holds.
  if (midgame.coverage >= 0.25 && midgame.hiddenStateSamples >= minSamples && c.rankingStable) {
    return {
      accepted: true,
      reason: 'coverage-diagnostic',
      detail: `coverage=${midgame.coverage.toFixed(4)} rankingStable`,
    };
  }

  return {
    accepted: false,
    reason: 'not-converged',
    detail:
      `samples=${midgame.hiddenStateSamples} coverage=${midgame.coverage.toFixed(4)} `
      + `sameTop=${c.sameTopAction} rankStable=${c.rankingStable} `
      + `lossDelta=${c.lossDelta.toFixed(4)} valueDelta=${c.valueDelta.toFixed(4)}`,
  };
}

export function isStabilityConverged(convergence: MidgameConvergence, sampleCount: number): boolean {
  return (
    sampleCount >= MIN_SAMPLES_FOR_STABILITY
    && convergence.sameTopAction
    && convergence.rankingStable
    && convergence.lossDelta <= EVALUATION_STABILITY_EPSILON
    && convergence.valueDelta <= EVALUATION_STABILITY_EPSILON
  );
}
