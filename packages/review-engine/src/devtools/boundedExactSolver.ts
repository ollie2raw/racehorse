/**
 * The offline view of the bounded exact path (docs/review-bounded-exact-2026-11-07.md). Since the bounded path was built for production the engine itself lives in
 * ../boundedExactSearch.ts (the code the server runs when REVIEW_BOUNDED_EXACT_ENABLED is on); this file keeps what only the studies need: a timed live source (wall ms per
 * hand, so cost can be read off a recording), a source over a recording of every hand's values, and a `grade` on the result.
 *
 * Four variants share the one engine:
 *   A  visit the DISTINCT opponent hands in a seeded random permutation (sampling without replacement); per candidate accumulate paired differences (running n, sum,
 *      sum of squares) between every pair of candidates, so best-minus-played and top1-minus-top2 are both available; finite-population correction on every interval.
 *   B  sequential stopping: after `minHands`, check every `step`; stop when the confidence interval of (best minus played) lies inside one grade band or its half-width is
 *      under `halfWidth`, or a cap (hands or time) is reached; when the enumeration finishes the result is exact over the hands.
 *   C  candidate racing: drop a candidate once it is clearly beaten by the current best, never the best or the played move.
 *   D  anytime output: a cap or a time budget never yields "no result": the best-so-far verdict is returned with its interval and `partial: true`.
 */
import { performance } from 'node:perf_hooks';
import type { NodeBudget } from '../searchGameTree';
import {
  BOUNDED_EXACT_MAX_HANDS,
  BOUNDED_EXACT_PLY_DEPTH,
  buildHandUniverse,
  handOrder,
  liveHandSource as productionLiveHandSource,
  runBounded as productionRunBounded,
  type BoundedResult as ProductionResult,
  type BoundedRunOptions,
  type HandSource as ProductionHandSource,
  type HandUniverse,
  type StopReason,
} from '../boundedExactSearch';
import { gradeOfLoss, type Grade } from './reviewSamplingStudyLib';

export const EXACT_PATH_MAX_STATE_SPACE = BOUNDED_EXACT_MAX_HANDS;
export const EXACT_PATH_PLY_DEPTH = BOUNDED_EXACT_PLY_DEPTH;
export { buildHandUniverse, handOrder };
export type { HandUniverse, StopReason };
export type BoundedOptions = BoundedRunOptions;

export type HandValues = {
  /** Per legal action: value difference from the decision point at the search's cutoff (NaN for an action not evaluated). */
  readonly d: readonly number[];
  /** Per legal action: game-tree nodes it took. */
  readonly nodes: readonly number[];
  /** Wall time of the whole hand (ms). */
  readonly ms: number;
};

export type HandSource = ProductionHandSource & { hand(i: number, alive: readonly boolean[]): HandValues };

/** The live source with wall timing per hand: the production search (no node cap here, so the recording covers every hand), in a seeded random order. */
export function liveHandSource(universe: HandUniverse, seed: string, maxPips = 6, plyDepth = EXACT_PATH_PLY_DEPTH): HandSource {
  const budget: NodeBudget = { count: 0, max: Number.MAX_SAFE_INTEGER };
  const source = productionLiveHandSource(universe, seed, { lockedYard: false, plyDepth }, budget, undefined, maxPips);
  return {
    ...source,
    hand(i, alive) {
      const started = performance.now();
      const values = source.hand(i, alive);
      return { d: values.d, nodes: values.nodes, ms: performance.now() - started };
    },
  };
}

/** A source over a recording of every hand's values (all actions, in the visiting order), for the offline study. */
export function recordedHandSource(recording: { actionKeys: readonly string[]; playedIndex: number; hands: readonly HandValues[] }): HandSource {
  return {
    total: recording.hands.length,
    actions: recording.actionKeys.length,
    playedIndex: recording.playedIndex,
    actionKeys: recording.actionKeys,
    hand: (i) => recording.hands[i]!,
  };
}

export type BoundedResult = ProductionResult & { readonly grade: Grade };

export function runBounded(source: ProductionHandSource, options: BoundedOptions): BoundedResult {
  const result = productionRunBounded(source, options);
  return { ...result, grade: gradeOfLoss(result.loss) };
}
