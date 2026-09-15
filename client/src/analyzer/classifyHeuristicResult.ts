import type { ReviewAction, ReviewCandidateEvaluationV1, ReviewEvaluationV1 } from '@racehorse/game-core/review';

export type HeuristicClassification =
  | { readonly kind: 'forced' }
  | { readonly kind: 'unclear'; readonly reason: 'globally-infeasible' | 'flat-spread' }
  | { readonly kind: 'bucket'; readonly bucket: 'Good' | 'Inaccuracy' | 'Blunder' };

// Provisional, from a real but tiny (n=3) dataset -- see issue #231 for the
// full evidentiary basis and what would need to happen before these are
// finalized (real product/data review against live game data).
const FLAT_SPREAD_THRESHOLD = 5;
const GOOD_THRESHOLD = 0.25;
const INACCURACY_THRESHOLD = 0.6;

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
 * comparison (orientation-independence in particular) is the one piece of
 * classifyHeuristicResult most likely to hide a subtle bug.
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

function findCandidateByAction(
  candidates: readonly ReviewCandidateEvaluationV1[],
  action: ReviewAction,
): ReviewCandidateEvaluationV1 | undefined {
  // Same JSON.stringify(action) equality convention evaluateReviewPosition.ts's
  // own findPlayedCandidate uses -- reused deliberately rather than
  // reinventing tile-matching logic.
  const key = JSON.stringify(action);
  return candidates.find((c) => JSON.stringify(c.action) === key);
}

/**
 * Phase C (game-review-oracle-upgrade-2026-09-13.md): classifies a
 * heuristic-confidence ReviewEvaluationV1 into the coarse 3-bucket scale,
 * a distinct "Unclear" state, or "forced" -- never the full 6-bucket scale
 * classifyMove uses for exact/search results, which this function neither
 * touches nor replaces. Client-side (not packages/review-engine) because
 * bucket/rating policy is a presentation concern, the same reasoning that
 * already keeps classifyMove and MoveRating client-side.
 */
export function classifyHeuristicResult(evaluation: ReviewEvaluationV1): HeuristicClassification {
  // Unconditional, before anything else: no valid hidden-state model at
  // all is a different kind of not-knowing than "the heuristic evaluated
  // fine but everything looked equally good" -- confirmed during research
  // that globally-infeasible can coexist with a large, real spread, so
  // spread must never be allowed to override this.
  if (evaluation.heuristicFallbackReason === 'globally-infeasible') {
    return { kind: 'unclear', reason: 'globally-infeasible' };
  }

  const playedCandidate = findCandidateByAction(evaluation.candidates, evaluation.played.action);
  const playedRawScore = playedCandidate?.rawScore;

  const deduped = dedupeCandidatesByTile(evaluation.candidates);
  const rawScores = deduped
    .map((c) => c.rawScore)
    .filter((score): score is number => typeof score === 'number');

  if (rawScores.length < 2) {
    // Either a genuinely single-legal-move decision, or multiple candidates
    // that all turned out to be position-variants of the same tile -- both
    // are "no real choice existed here", not "we don't know which was
    // best".
    return { kind: 'forced' };
  }

  const best = Math.max(...rawScores);
  const worst = Math.min(...rawScores);
  const spread = best - worst;

  if (spread < FLAT_SPREAD_THRESHOLD) {
    return { kind: 'unclear', reason: 'flat-spread' };
  }

  if (typeof playedRawScore !== 'number') {
    // The played action's own candidate carries a rawScore whenever the
    // solver produced any real candidates at all (confirmed: B4 always
    // includes the played action among its candidates) -- a miss here
    // means the upstream result is malformed, not a legitimate runtime
    // case to paper over with a guess.
    throw new Error('classifyHeuristicResult: no rawScore found for the played action.');
  }

  const normalizedLoss = (best - playedRawScore) / spread;
  if (normalizedLoss <= GOOD_THRESHOLD) return { kind: 'bucket', bucket: 'Good' };
  if (normalizedLoss <= INACCURACY_THRESHOLD) return { kind: 'bucket', bucket: 'Inaccuracy' };
  return { kind: 'bucket', bucket: 'Blunder' };
}
