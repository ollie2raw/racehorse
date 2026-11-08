/**
 * Honest labelling for a sampled review verdict that was cut short (docs/review-partial-honesty-2026-11-08.md).
 *
 * The sampler stops early when the wall-clock ceiling or a node budget fires. On the free production instance (about 0.15 CPU, roughly 45 times slower than a laptop) that
 * happens to real decisions: a verdict built from 45 hidden hands instead of the 100 asked for still shipped as "Review Engine search, medium confidence" with a full severity
 * badge, and nothing the client reads said it had been cut. This module gives such a result the same treatment #502 gave a capped locked yard: `partialSearch` with a 95%
 * interval of the played move's loss, a severity badge (or "Best") only when that interval lies inside one grade band, otherwise confidence 'low' and no badge.
 *
 * Everything here is pure. It is reached only when the caller asked for it (`cutHonesty`, set by the server when REVIEW_CUT_HONESTY_ENABLED is "true"); a default call is untouched.
 */
import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { intervalInsideOneBand } from './gradeBands';
import type { PairedSampleStats } from './solveMidgameDeterminization';

/** 95% two-sided normal quantile. The number of hands is small (tens), so this is a deliberate approximation: see "limits" in the doc. */
export const PARTIAL_INTERVAL_Z = 1.96;
export const PARTIAL_INTERVAL_CONFIDENCE = 0.95;
/** An unbounded side of an interval, as #502 reports it. */
export const UNBOUNDED_LOSS = 1_000_000;

export type PartialSearchField = NonNullable<ReviewEvaluationV1['partialSearch']>;

/**
 * 95% interval of the played move's TRUE loss from paired per-hand differences.
 *
 * The true loss is the best alternative's mean advantage over the played move, never below 0 (playing the move itself is an option): L = max(0, max over a of mu_a), where
 * mu_a is the mean of value(a) - value(played). Each mu_a gets a normal interval, and the interval for L is [max(0, largest lower bound), max(0, largest upper bound)]. Taking
 * the largest upper bound over every alternative is deliberately conservative: it is what stops a verdict that merely LOOKS best on few hands from being called Best, and it
 * is also why a move that really is the best has an interval of exactly [0, 0] only when every alternative is clearly behind it. With fewer than 2 hands nothing is known, and
 * the interval is [0, UNBOUNDED_LOSS].
 */
export function pairedLossInterval(stats: Pick<PairedSampleStats, 'samples' | 'playedIndex' | 'sum' | 'sumSquares'>, z: number = PARTIAL_INTERVAL_Z): readonly [number, number] | null {
  const n = stats.samples;
  if (stats.playedIndex < 0) return null;
  if (n < 2) return [0, UNBOUNDED_LOSS];
  let lower = 0;
  let upper = 0;
  for (let a = 0; a < stats.sum.length; a += 1) {
    if (a === stats.playedIndex) continue;
    const mean = stats.sum[a]! / n;
    const variance = Math.max(0, (stats.sumSquares[a]! - n * mean * mean) / (n - 1));
    const halfWidth = z * Math.sqrt(variance / n);
    lower = Math.max(lower, mean - halfWidth);
    upper = Math.max(upper, mean + halfWidth);
  }
  return [lower, upper];
}

export function buildPartialSearch(
  stats: PairedSampleStats,
  reason: PartialSearchField['reason'],
  samplesRequested: number,
): PartialSearchField | null {
  const lossInterval = pairedLossInterval(stats);
  if (!lossInterval) return null;
  return {
    partial: true,
    reason,
    samplesSolved: stats.samples,
    samplesRequested,
    lossInterval,
    confidence: PARTIAL_INTERVAL_CONFIDENCE,
  };
}

/**
 * A locked-yard exact result that was cut before every allocation was solved. The exact solver averages over the allocations solved so far and still returns them as
 * "Exact analysis, high confidence" (with every value 0 when it solved none); it enumerates in a fixed order, not a random one, so no interval can honestly be put on it.
 * The interval is therefore unbounded: the badge rule withholds every badge, "Best" included. The evidence label itself stays as the contract types it (a literal union:
 * 'exact' / 'high' / "Exact analysis"); changing that is a contract change this flag does not make (see the doc, "left alone").
 */
function markCutExact(evaluation: ReviewEvaluationV1, reason: PartialSearchField['reason']): ReviewEvaluationV1 {
  const { complete, coverage, hiddenStateSamples } = evaluation.search;
  if (evaluation.boundedSearch || complete !== false || coverage >= 1) return evaluation;
  return {
    ...evaluation,
    partialSearch: {
      partial: true,
      reason,
      samplesSolved: hiddenStateSamples,
      // 0 = not known (nothing was solved, so the total cannot be recovered from the coverage).
      samplesRequested: coverage > 0 ? Math.round(hiddenStateSamples / coverage) : 0,
      lossInterval: [0, UNBOUNDED_LOSS],
      confidence: PARTIAL_INTERVAL_CONFIDENCE,
    },
  };
}

/**
 * Marks a cut result. A sampled `search` evaluation whose run really stopped before its sample budget or by a node budget (`complete === false`) gains `partialSearch` with a 95%
 * loss interval; when that interval spans more than one grade band it also drops to confidence 'low', so the header reads "Review Engine search · low confidence" and the badge
 * rule (severityBadgeAllowed) shows no badge. A cut locked-yard `exact` result gains `partialSearch` with an unbounded interval (no badge). Every other evaluation (heuristic,
 * bounded, a full run that merely finished past the ceiling) is returned as the very same object.
 */
export function markCutEvaluation(
  evaluation: ReviewEvaluationV1,
  stats: PairedSampleStats | undefined,
  reason: PartialSearchField['reason'],
  samplesRequested: number,
): ReviewEvaluationV1 {
  if (evaluation.evidence.source === 'exact') return markCutExact(evaluation, reason);
  if (evaluation.evidence.source !== 'search') return evaluation;
  if (evaluation.search.complete !== false) return evaluation;
  if (!stats || (stats.samples >= samplesRequested && reason !== 'budget')) return evaluation;
  const partialSearch = buildPartialSearch(stats, reason, samplesRequested);
  if (!partialSearch) return evaluation;
  const spans = !intervalInsideOneBand(partialSearch.lossInterval);
  return {
    ...evaluation,
    ...(spans ? { evidence: { ...evaluation.evidence, confidence: 'low' as const } } : {}),
    partialSearch,
  };
}
