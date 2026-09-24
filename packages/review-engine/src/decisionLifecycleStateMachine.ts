import type { ReviewDecisionLifecycle } from '@racehorse/game-core/review';

/**
 * Authoritative decision-lifecycle state machine for fresh-game completeness.
 *
 * FORCED and SCORED are successful terminals.
 * FAILED_FATAL is terminal only for proven corrupt/unsupported capture input.
 * FAILED_RETRYABLE always returns to PENDING (requeue) before SEARCHING again.
 */

export const DECISION_LIFECYCLE_TERMINALS: ReadonlySet<ReviewDecisionLifecycle> = new Set([
  'SCORED',
  'FORCED',
  'FAILED_FATAL',
]);

const ALLOWED: ReadonlyMap<ReviewDecisionLifecycle, ReadonlySet<ReviewDecisionLifecycle>> = new Map([
  ['PENDING', new Set(['SEARCHING', 'FORCED', 'SCORED', 'FAILED_FATAL'])],
  ['SEARCHING', new Set(['SCORED', 'FORCED', 'FAILED_RETRYABLE', 'FAILED_FATAL', 'SEARCHING'])],
  ['FAILED_RETRYABLE', new Set(['PENDING', 'SEARCHING'])],
  ['SCORED', new Set()],
  ['FORCED', new Set()],
  ['FAILED_FATAL', new Set()],
]);

export function isAllowedLifecycleTransition(
  from: ReviewDecisionLifecycle,
  to: ReviewDecisionLifecycle,
): boolean {
  if (from === to && (from === 'SEARCHING' || from === 'PENDING')) return true;
  return ALLOWED.get(from)?.has(to) ?? false;
}

export function assertLifecycleTransition(
  from: ReviewDecisionLifecycle,
  to: ReviewDecisionLifecycle,
): void {
  if (!isAllowedLifecycleTransition(from, to)) {
    throw new Error(`Illegal review lifecycle transition: ${from} → ${to}`);
  }
}

export function transitionLifecycle(
  from: ReviewDecisionLifecycle,
  to: ReviewDecisionLifecycle,
): ReviewDecisionLifecycle {
  assertLifecycleTransition(from, to);
  return to;
}

/**
 * Whether FAILED_FATAL is permitted for this failure class.
 * Compute-budget / search-difficulty reasons must NEVER enter FAILED_FATAL.
 */
export function mayEnterFailedFatal(
  reason: string | undefined,
): boolean {
  if (!reason) return false;
  return reason === 'corrupt-snapshot';
}
