/**
 * DESIGN PROTOTYPE, devtools only (docs/review-single-depth-design-2026-11-08.md). Not imported by production code; nothing here is reachable from the server or the client.
 *
 * The single-depth pipeline at 3 plies, as small as it can be:
 *   - the unit of work is ONE hand index i of a decision: a hidden opponent hand AND a boneyard order, both a pure function of (seed key, i). Unit i never depends on how many units
 *     are run, on which machine, or in which order the units are run, so a result is a function of (decision, seed key, depth, N).
 *   - per decision, the sufficient statistics of the units 0..N-1: n, and for every action a and every pair of actions (a, b) the sum and sum of squares of the per-unit values.
 *     They ADD: stats(0..100) + stats(100..400) = stats(0..400) exactly (integer sums), so a device can run 100 units now, the same device (or the server, or another device) can run
 *     100..400 later, and the merged result equals a straight run of 400.
 *   - the verdict (best action, loss of the played move, grade, interval) is computed from the statistics alone, never from the units.
 *
 * Units: a position with at most 8,000 distinct hidden hands walks a seeded permutation of them and cycles through it again when N exceeds the count, giving every cycle a NEW boneyard
 * order (so N hands means N independent boneyard draws even when there are only 14 distinct hands: the boneyard order, not the hand, was the measured noise floor of #501/#502).
 * A larger position draws unit i from sampleHiddenAllocation(snapshot, `${seed}:${i}`), exactly the sampler the ladder uses today.
 */
import { applyGameCommand, createDeterministicRandom, shuffleDeterministically, type Config, type GameState, type Tile } from '@racehorse/game-core';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { buildHandUniverse, handOrder, type HandUniverse } from '../boundedExactSearch';
import { resolveReviewConfig } from '../reviewRuleset';
import { sampleHiddenAllocation } from '../sampleHiddenAllocation';
import { commandForAction, searchGameTree, type GameTreeWalkConfig, type NodeBudget } from '../searchGameTree';
import { canonicalActionKey, gradeOfLoss, type Grade } from './reviewSamplingStudyLib';

export const SINGLE_DEPTH_ENGINE = 'single-depth-v1';

export type Stats = {
  n: number;
  readonly sum: number[];
  readonly sumsq: number[];
  /** [a][b] for a < b: sum and sum of squares of (value_a - value_b) */
  readonly pairSum: number[][];
  readonly pairSumsq: number[][];
};

export const newStats = (actions: number): Stats => ({
  n: 0,
  sum: new Array<number>(actions).fill(0),
  sumsq: new Array<number>(actions).fill(0),
  pairSum: Array.from({ length: actions }, () => new Array<number>(actions).fill(0)),
  pairSumsq: Array.from({ length: actions }, () => new Array<number>(actions).fill(0)),
});

export function addUnit(stats: Stats, d: readonly number[]): void {
  stats.n += 1;
  for (let a = 0; a < d.length; a += 1) {
    stats.sum[a]! += d[a]!;
    stats.sumsq[a]! += d[a]! * d[a]!;
    for (let b = a + 1; b < d.length; b += 1) {
      const diff = d[a]! - d[b]!;
      stats.pairSum[a]![b]! += diff;
      stats.pairSumsq[a]![b]! += diff * diff;
    }
  }
}

/** Statistics of two disjoint unit ranges add. */
export function mergeStats(x: Stats, y: Stats): Stats {
  const out = newStats(x.sum.length);
  out.n = x.n + y.n;
  for (let a = 0; a < x.sum.length; a += 1) {
    out.sum[a] = x.sum[a]! + y.sum[a]!;
    out.sumsq[a] = x.sumsq[a]! + y.sumsq[a]!;
    for (let b = a + 1; b < x.sum.length; b += 1) {
      out.pairSum[a]![b] = x.pairSum[a]![b]! + y.pairSum[a]![b]!;
      out.pairSumsq[a]![b] = x.pairSumsq[a]![b]! + y.pairSumsq[a]![b]!;
    }
  }
  return out;
}

export type StatsVerdict = {
  readonly n: number;
  readonly topIndex: number;
  readonly top: string;
  readonly loss: number;
  readonly grade: Grade;
  /** 95% interval of (best - played), plain normal approximation on the paired statistics. */
  readonly interval: readonly [number, number];
  readonly means: readonly number[];
};

export function verdictOf(stats: Stats, playedIndex: number, actionKeys: readonly string[]): StatsVerdict {
  const A = actionKeys.length;
  const mean = (a: number) => (stats.n > 0 ? stats.sum[a]! / stats.n : 0);
  const order = [...Array(A).keys()].sort((a, b) => (mean(b) !== mean(a) ? mean(b) - mean(a) : actionKeys[a]! < actionKeys[b]! ? -1 : 1));
  const best = order[0]!;
  const loss = mean(best) - mean(playedIndex);
  let half = 0;
  if (best !== playedIndex && stats.n > 1) {
    const [lo, hi] = best < playedIndex ? [best, playedIndex] : [playedIndex, best];
    const sign = best < playedIndex ? 1 : -1;
    const m = (sign * stats.pairSum[lo]![hi]!) / stats.n;
    const variance = Math.max(0, (stats.pairSumsq[lo]![hi]! - stats.n * m * m) / (stats.n - 1));
    half = 1.96 * Math.sqrt(variance / stats.n);
  } else if (best !== playedIndex) half = Number.POSITIVE_INFINITY;
  return {
    n: stats.n, topIndex: best, top: actionKeys[best]!, loss, grade: gradeOfLoss(loss),
    interval: [Math.max(0, loss - half), loss + half], means: Array.from({ length: A }, (_, a) => mean(a)),
  };
}

export type UnitRunner = {
  readonly engine: string;
  readonly plyDepth: number;
  readonly seedKey: string;
  readonly actions: number;
  readonly actionKeys: readonly string[];
  readonly playedIndex: number;
  /** distinct hidden hands when the position walks a permutation (<= 8,000), null when units are drawn */
  readonly distinctHands: number | null;
  /** Values of unit i: per legal action, the value difference from the decision point at the search's cutoff. */
  unit(i: number): number[];
};

/** The runner of one decision. `seedKey` is `${decisionId}` plus a salt chosen by the caller; the unit stream is a pure function of (snapshot, seedKey, plyDepth). */
export function unitRunner(snapshot: ReviewPositionSnapshotV2, seedKey: string, plyDepth = 3, maxPips = 6): UnitRunner {
  const universe: HandUniverse | null = snapshot.preAction.boneyard.drawableCount > 0 ? buildHandUniverse(snapshot, maxPips) : null;
  const order = universe ? handOrder(universe, seedKey) : null;
  const { actorId, opponentId, handNumber } = snapshot.identifiers;
  const { actorHand, board, scores, consecutivePasses, handOpen } = snapshot.preAction;
  const rootDiff = scores.actor - scores.opponent;
  const config: Config = { ...resolveReviewConfig(snapshot, maxPips), deadTileCount: snapshot.preAction.boneyard.deadCount };
  const walk = {
    shouldStop: undefined, actorId, opponentId,
    isCutoff: (state: GameState, depth: number) => state.handOver || state.gameOver || depth >= plyDepth,
    leafValue: (state: GameState) => state.players[actorId].score - state.players[opponentId].score,
  } as unknown as GameTreeWalkConfig;
  const actionKeys = snapshot.legalActions.map(canonicalActionKey);
  const playedIndex = Math.max(0, actionKeys.indexOf(canonicalActionKey(snapshot.actualAction)));
  const { drawableCount } = snapshot.preAction.boneyard;

  const valuesFor = (opponentHand: readonly Tile[], drawable: readonly Tile[], dead: readonly Tile[]): number[] =>
    snapshot.legalActions.map((action) => {
      const root = {
        config, playerIds: [actorId, opponentId],
        players: { [actorId]: { id: actorId, hand: actorHand, score: scores.actor }, [opponentId]: { id: opponentId, hand: opponentHand, score: scores.opponent } },
        board, boneyard: [...drawable, ...dead], deadTiles: dead, currentPlayerIndex: 0, handNumber, handOpen, handOver: false, gameOver: false, winnerId: null, consecutivePasses, sequence: 0,
      } as unknown as GameState;
      const { state: post } = applyGameCommand(root, commandForAction(root, actorId, action));
      const budget: NodeBudget = { count: 0, max: Number.MAX_SAFE_INTEGER };
      return searchGameTree(post, 0, walk, budget).diff - rootDiff;
    });

  return {
    engine: SINGLE_DEPTH_ENGINE, plyDepth, seedKey, actions: snapshot.legalActions.length, actionKeys, playedIndex,
    distinctHands: universe ? universe.combinations.length : null,
    unit(i) {
      if (universe && order) {
        const combo = universe.combinations[order[i % order.length]!]!;
        const chosen = new Set(combo);
        const leftover = universe.eligible.filter((_, index) => !chosen.has(index));
        const remaining = shuffleDeterministically([...leftover, ...universe.boneyardOnly], createDeterministicRandom(`${seedKey}:u${i}`)) as Tile[];
        return valuesFor(combo.map((index) => universe.eligible[index]!), remaining.slice(0, drawableCount), remaining.slice(drawableCount));
      }
      const allocation = sampleHiddenAllocation(snapshot, `${seedKey}:${i}`, maxPips);
      if (allocation === null) throw new Error('single-depth: infeasible position');
      return valuesFor(allocation.opponentHand, allocation.boneyardDrawable, allocation.boneyardDead);
    },
  };
}

/** Statistics of units [from, to). */
export function runRange(runner: UnitRunner, from: number, to: number): Stats {
  const stats = newStats(runner.actions);
  for (let i = from; i < to; i += 1) addUnit(stats, runner.unit(i));
  return stats;
}
