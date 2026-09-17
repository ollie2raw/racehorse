import type { ReviewAction, ReviewCandidateEvaluationV1 } from './reviewContracts';

function tileIdentityKey(action: ReviewAction): string {
  if (action.kind !== 'play') return action.kind;
  // Tiles are always stored low<=high elsewhere in this codebase, but this
  // key must not silently depend on that invariant -- compare canonically.
  const lo = Math.min(action.tile.low, action.tile.high);
  const hi = Math.max(action.tile.low, action.tile.high);
  return `play:${lo}-${hi}`;
}

/**
 * Collapses candidates that are the same tile at different board positions
 * (left/right/branch-N-M) into one entry, keeping the highest rawScore
 * among its variants. Exported and independently tested since tile-identity
 * comparison (orientation-independence in particular) is the one piece most
 * likely to hide a subtle bug.
 *
 * Lives in game-core (not client) so it can be shared by both client-side
 * classification (`classifyHeuristicResult.ts`, which re-exports this) and
 * server-reusable aggregate computation (`@racehorse/review-engine`'s
 * `reviewAccuracy.ts`), which has no dependency on client code.
 */
export function dedupeCandidatesByTile(
  candidates: readonly ReviewCandidateEvaluationV1[],
): readonly ReviewCandidateEvaluationV1[] {
  const byKey = new Map<string, ReviewCandidateEvaluationV1>();
  for (const candidate of candidates) {
    const key = tileIdentityKey(candidate.action);
    const existing = byKey.get(key);
    const existingScore = existing?.rawScore ?? Number.NEGATIVE_INFINITY;
    const candidateScore = candidate.rawScore ?? Number.NEGATIVE_INFINITY;
    if (!existing || candidateScore > existingScore) {
      byKey.set(key, candidate);
    }
  }
  return Array.from(byKey.values());
}
