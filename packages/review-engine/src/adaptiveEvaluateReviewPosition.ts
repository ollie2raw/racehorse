import { isForcedDecision } from '@racehorse/game-core/review';
import type {
  ReviewDecisionLifecycle,
  ReviewEvaluationV1,
  ReviewPositionSnapshotV2,
} from '@racehorse/game-core/review';
import { computePublicPositionHash } from '@racehorse/game-core/review';
import {
  evaluateReviewPosition,
  type ReviewDispatchBudget,
  WALL_CLOCK_CEILING_DIAGNOSTIC,
} from './evaluateReviewPosition';
import { resolveCausalEvidence } from './evidenceLifecycle';
import { resolveHiddenPoolEligibility } from './hiddenPoolEligibility';
import { countCombinations } from './combinations';
import { decideSearchConvergence } from './evaluationConvergence';

/**
 * Search escalation ladder. After tier 4, progressive chunks continue until
 * evaluation stability converges — a fixed tier budget cannot permanently
 * strand a correctly captured legal position.
 */
export const SEARCH_ESCALATION_TIERS: readonly {
  readonly tier: 1 | 2 | 3 | 4;
  readonly budget: ReviewDispatchBudget;
}[] = [
  {
    tier: 1,
    budget: {
      maxNodes: 200_000,
      maxHiddenStateSamples: 100,
      maxPlyDepth: 2,
      seed: 'racehorse-review-tier-1',
      maxWallClockMs: 2_000,
    },
  },
  {
    tier: 2,
    budget: {
      maxNodes: 5_000_000,
      maxHiddenStateSamples: 2500,
      maxPlyDepth: 2,
      seed: 'racehorse-review-tier-2',
      maxWallClockMs: 120_000,
    },
  },
  {
    tier: 3,
    budget: {
      maxNodes: 25_000_000,
      maxHiddenStateSamples: 12_000,
      maxPlyDepth: 2,
      seed: 'racehorse-review-tier-3',
      maxWallClockMs: 600_000,
    },
  },
  {
    tier: 4,
    budget: {
      maxNodes: 100_000_000,
      maxHiddenStateSamples: 50_000,
      maxPlyDepth: 3,
      seed: 'racehorse-review-tier-4',
      maxWallClockMs: 1_800_000,
    },
  },
] as const;

/** Exact enumeration when C(n,k) is at or below this threshold. */
export const EXACT_ENUMERATION_STATE_SPACE_THRESHOLD = 8_000;

/** Progressive chunk after tier 4 — resumable convergent sampling. */
export const PROGRESSIVE_CHUNK_SAMPLES = 10_000;
export const PROGRESSIVE_CHUNK_NODES = 50_000_000;
export const PROGRESSIVE_CHUNK_WALL_MS = 600_000;
export const PROGRESSIVE_MAX_CHUNKS_PER_PASS = 4;

export const ADAPTIVE_COVERAGE_THRESHOLD = 0.02;

export type AdaptiveEvaluateResult = {
  readonly evaluation: ReviewEvaluationV1;
  readonly lifecycle: ReviewDecisionLifecycle;
  readonly tier: 1 | 2 | 3 | 4 | null;
  readonly positionHash: string;
  readonly evidencePolicy: ReturnType<typeof resolveCausalEvidence>['policy'];
  readonly feasible: boolean;
  readonly estimatedStateSpace: number;
  readonly convergenceReason?: string;
};

function withProvenance(
  evaluation: ReviewEvaluationV1,
  args: {
    lifecycle: ReviewDecisionLifecycle;
    phase: 'live' | 'completion';
    positionHash: string;
    tier?: 1 | 2 | 3 | 4;
    failureReason?: NonNullable<ReviewEvaluationV1['evaluationProvenance']>['failureReason'];
    detail?: string;
  },
): ReviewEvaluationV1 {
  return {
    ...evaluation,
    evaluationProvenance: {
      phase: args.phase,
      lifecycle: args.lifecycle,
      positionHash: args.positionHash,
      ...(args.tier ? { escalationTier: args.tier } : {}),
      ...(args.failureReason ? { failureReason: args.failureReason } : {}),
      ...(args.detail ? { detail: args.detail } : {}),
    },
  };
}

function isEngineScored(evaluation: ReviewEvaluationV1): boolean {
  return evaluation.evidence.source === 'exact' || evaluation.evidence.source === 'search';
}

function estimateStateSpace(snapshot: ReviewPositionSnapshotV2): number {
  const { eligibleForOpponent } = resolveHiddenPoolEligibility(snapshot);
  const k = snapshot.preAction.opponentTileCount;
  if (k < 0 || eligibleForOpponent.length < k) return 0;
  return countCombinations(eligibleForOpponent.length, k);
}

/**
 * Evaluate with escalating budgets until exact/search converges.
 * Beyond tier 4, progressive chunks continue within this call (bounded per
 * pass). Interrupt via `shouldAbort` → FAILED_RETRYABLE for durable resume.
 * Budget exhaustion alone never yields FAILED_FATAL.
 */
export function adaptiveEvaluateReviewPosition(
  snapshot: ReviewPositionSnapshotV2,
  options?: {
    readonly startTier?: 1 | 2 | 3 | 4;
    readonly maxTier?: 1 | 2 | 3 | 4;
    readonly coverageThreshold?: number;
    readonly evaluate?: typeof evaluateReviewPosition;
    readonly phase?: 'live' | 'completion';
    /** When true (default for completion), continue progressive chunks past tier 4. */
    readonly allowProgressiveBeyondTier?: boolean;
    readonly progressiveChunks?: number;
    readonly shouldAbort?: () => boolean;
    readonly progressiveSampleOffset?: number;
  },
): AdaptiveEvaluateResult {
  const evaluate = options?.evaluate ?? evaluateReviewPosition;
  const coverageThreshold = options?.coverageThreshold ?? ADAPTIVE_COVERAGE_THRESHOLD;
  const phase = options?.phase ?? 'completion';
  const startTier = options?.startTier ?? 1;
  const maxTier = options?.maxTier ?? 4;
  const allowProgressive = options?.allowProgressiveBeyondTier ?? phase === 'completion';
  const progressiveChunks = options?.progressiveChunks ?? PROGRESSIVE_MAX_CHUNKS_PER_PASS;
  const positionHash = snapshot.integrity.positionHash ?? computePublicPositionHash(snapshot);

  const evidence = resolveCausalEvidence(snapshot);
  const estimatedStateSpace = estimateStateSpace(snapshot);
  const { eligibleForOpponent } = resolveHiddenPoolEligibility(snapshot);
  const feasible = eligibleForOpponent.length >= snapshot.preAction.opponentTileCount;

  if (!feasible) {
    const stub = evaluate(snapshot, SEARCH_ESCALATION_TIERS[0]!.budget, coverageThreshold);
    const conflict = evidence.minimalConflictSet;
    return {
      evaluation: withProvenance(stub, {
        lifecycle: 'FAILED_FATAL',
        phase,
        positionHash,
        failureReason: 'corrupt-snapshot',
        detail:
          `hidden pool infeasible after causal evidence (policy=${evidence.policy}); `
          + `conflictPips=${conflict?.map((c) => c.pip).join(',') ?? 'none'}`,
      }),
      lifecycle: 'FAILED_FATAL',
      tier: null,
      positionHash,
      evidencePolicy: evidence.policy,
      feasible: false,
      estimatedStateSpace,
    };
  }

  // Tractable state space: prefer exact-style large sample/enumeration budget.
  if (estimatedStateSpace > 0 && estimatedStateSpace <= EXACT_ENUMERATION_STATE_SPACE_THRESHOLD) {
    if (options?.shouldAbort?.()) {
      const stub = evaluate(snapshot, SEARCH_ESCALATION_TIERS[0]!.budget, coverageThreshold);
      return {
        evaluation: withProvenance(stub, {
          lifecycle: 'FAILED_RETRYABLE',
          phase,
          positionHash,
          failureReason: 'evaluation-error',
          detail: 'aborted before exact enumeration',
        }),
        lifecycle: 'FAILED_RETRYABLE',
        tier: 1,
        positionHash,
        evidencePolicy: evidence.policy,
        feasible: true,
        estimatedStateSpace,
      };
    }
    const exactBudget: ReviewDispatchBudget = {
      maxNodes: 100_000_000,
      maxHiddenStateSamples: Math.max(estimatedStateSpace, 1),
      maxPlyDepth: 3,
      seed: 'racehorse-review-exact-enum',
      maxWallClockMs: 1_800_000,
    };
    const raw = evaluate(snapshot, exactBudget, coverageThreshold);
    if (isForcedDecision(raw.candidates)) {
      return {
        evaluation: withProvenance(raw, {
          lifecycle: 'FORCED',
          phase,
          positionHash,
          tier: 1,
          detail: `exact-enum stateSpace=${estimatedStateSpace}`,
        }),
        lifecycle: 'FORCED',
        tier: 1,
        positionHash,
        evidencePolicy: evidence.policy,
        feasible: true,
        estimatedStateSpace,
        convergenceReason: 'exact-complete',
      };
    }
    if (isEngineScored(raw)) {
      return {
        evaluation: withProvenance(raw, {
          lifecycle: 'SCORED',
          phase,
          positionHash,
          tier: 1,
          detail: `exact-enum stateSpace=${estimatedStateSpace}`,
        }),
        lifecycle: 'SCORED',
        tier: 1,
        positionHash,
        evidencePolicy: evidence.policy,
        feasible: true,
        estimatedStateSpace,
        convergenceReason: 'exact-complete',
      };
    }
  }

  let last: ReviewEvaluationV1 | null = null;
  let lastTier: 1 | 2 | 3 | 4 = 1;

  for (const step of SEARCH_ESCALATION_TIERS) {
    if (step.tier < startTier) continue;
    if (step.tier > maxTier) break;
    if (options?.shouldAbort?.()) {
      const stub = last ?? evaluate(snapshot, SEARCH_ESCALATION_TIERS[0]!.budget, coverageThreshold);
      return {
        evaluation: withProvenance(stub, {
          lifecycle: 'FAILED_RETRYABLE',
          phase,
          positionHash,
          tier: step.tier,
          failureReason: 'evaluation-error',
          detail: 'aborted mid-escalation',
        }),
        lifecycle: 'FAILED_RETRYABLE',
        tier: step.tier,
        positionHash,
        evidencePolicy: evidence.policy,
        feasible: true,
        estimatedStateSpace,
      };
    }

    try {
      const raw = evaluate(snapshot, step.budget, coverageThreshold);
      last = raw;
      lastTier = step.tier;
      if (isForcedDecision(raw.candidates)) {
        return {
          evaluation: withProvenance(raw, {
            lifecycle: 'FORCED',
            phase,
            positionHash,
            tier: step.tier,
          }),
          lifecycle: 'FORCED',
          tier: step.tier,
          positionHash,
          evidencePolicy: evidence.policy,
          feasible: true,
          estimatedStateSpace,
          convergenceReason: 'forced',
        };
      }
      if (isEngineScored(raw)) {
        const conv = raw.diagnostics.find((d) => d.startsWith('eval-convergence:'))?.slice('eval-convergence:'.length);
        return {
          evaluation: withProvenance(raw, {
            lifecycle: 'SCORED',
            phase,
            positionHash,
            tier: step.tier,
            detail: evidence.policy !== 'hard' ? `evidencePolicy=${evidence.policy}` : undefined,
          }),
          lifecycle: 'SCORED',
          tier: step.tier,
          positionHash,
          evidencePolicy: evidence.policy,
          feasible: true,
          estimatedStateSpace,
          convergenceReason: conv ?? 'tier-scored',
        };
      }
      if (step.tier < maxTier) continue;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stub = last ?? evaluate(snapshot, SEARCH_ESCALATION_TIERS[0]!.budget, coverageThreshold);
      return {
        evaluation: withProvenance(stub, {
          lifecycle: 'FAILED_RETRYABLE',
          phase,
          positionHash,
          tier: step.tier,
          failureReason: 'evaluation-error',
          detail: message,
        }),
        lifecycle: 'FAILED_RETRYABLE',
        tier: step.tier,
        positionHash,
        evidencePolicy: evidence.policy,
        feasible: true,
        estimatedStateSpace,
      };
    }
  }

  // Progressive terminal solver beyond fixed tiers.
  if (allowProgressive) {
    let sampleOffset = options?.progressiveSampleOffset ?? 0;
    for (let chunk = 0; chunk < progressiveChunks; chunk += 1) {
      if (options?.shouldAbort?.()) break;
      sampleOffset += PROGRESSIVE_CHUNK_SAMPLES;
      const budget: ReviewDispatchBudget = {
        maxNodes: PROGRESSIVE_CHUNK_NODES,
        maxHiddenStateSamples: sampleOffset,
        maxPlyDepth: 3,
        seed: `racehorse-review-progressive:${sampleOffset}`,
        maxWallClockMs: PROGRESSIVE_CHUNK_WALL_MS,
      };
      try {
        const raw = evaluate(snapshot, budget, coverageThreshold);
        last = raw;
        if (isEngineScored(raw) || isForcedDecision(raw.candidates)) {
          const life = isForcedDecision(raw.candidates) ? 'FORCED' : 'SCORED';
          const conv = raw.diagnostics.find((d) => d.startsWith('eval-convergence:'))?.slice('eval-convergence:'.length);
          return {
            evaluation: withProvenance(raw, {
              lifecycle: life,
              phase,
              positionHash,
              tier: 4,
              detail: `progressive samples=${sampleOffset}`,
            }),
            lifecycle: life,
            tier: 4,
            positionHash,
            evidencePolicy: evidence.policy,
            feasible: true,
            estimatedStateSpace,
            convergenceReason: conv ?? 'progressive-converged',
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stub = last ?? evaluate(snapshot, SEARCH_ESCALATION_TIERS[0]!.budget, coverageThreshold);
        return {
          evaluation: withProvenance(stub, {
            lifecycle: 'FAILED_RETRYABLE',
            phase,
            positionHash,
            tier: 4,
            failureReason: 'evaluation-error',
            detail: message,
          }),
          lifecycle: 'FAILED_RETRYABLE',
          tier: 4,
          positionHash,
          evidencePolicy: evidence.policy,
          feasible: true,
          estimatedStateSpace,
        };
      }
    }
  }

  const raw = last ?? evaluate(snapshot, SEARCH_ESCALATION_TIERS[0]!.budget, coverageThreshold);
  const reason = raw.diagnostics.includes(WALL_CLOCK_CEILING_DIAGNOSTIC)
    ? 'wall-clock-exhausted'
    : raw.search.complete === false
      ? 'node-exhausted'
      : 'coverage-unreachable';

  // Still not converged this pass — retryable for durable requeue, never fatal.
  return {
    evaluation: withProvenance(raw, {
      lifecycle: 'FAILED_RETRYABLE',
      phase,
      positionHash,
      tier: lastTier,
      failureReason: reason,
      detail: `awaiting progressive resume; stateSpace=${estimatedStateSpace}`,
    }),
    lifecycle: 'FAILED_RETRYABLE',
    tier: lastTier,
    positionHash,
    evidencePolicy: evidence.policy,
    feasible: true,
    estimatedStateSpace,
    convergenceReason: decideSearchConvergence({
      candidates: raw.candidates,
      best: raw.best,
      nodes: raw.search.nodes,
      hiddenStateSamples: raw.search.hiddenStateSamples,
      coverage: raw.search.coverage,
      complete: raw.search.complete,
      convergence: {
        sameTopAction: raw.convergence?.sameTopAction ?? false,
        valueDelta: raw.convergence?.valueDelta ?? Infinity,
        lossDelta: Infinity,
        rankingStable: false,
        sampleCount: raw.search.hiddenStateSamples,
        feasibleStateEstimate: estimatedStateSpace,
      },
    }).reason,
  };
}
