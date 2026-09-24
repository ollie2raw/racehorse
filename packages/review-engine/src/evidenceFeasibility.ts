/**
 * @deprecated Prefer evidenceLifecycle.resolveCausalEvidence.
 * Compatibility shim: causal epoch invalidation (not drop-oldest).
 */
export {
  resolveCausalEvidence as resolveFeasibleEvidence,
  snapshotWithCausalEvidence as snapshotWithFeasibleEvidence,
} from './evidenceLifecycle';
export type {
  EvidenceLifecycleResolution as EvidenceFeasibilityResolution,
} from './evidenceLifecycle';
