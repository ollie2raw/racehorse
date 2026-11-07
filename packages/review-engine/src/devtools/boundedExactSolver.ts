/**
 * EXPERIMENT (docs/review-bounded-exact-2026-11-07.md). Not imported by production code; nothing here is reachable from the server or the client, so every variant is
 * "off" by construction. It explores a bounded alternative to the branch at adaptiveEvaluateReviewPosition.ts:239 ("exact enumeration": a hidden-hand space C(n,k) of
 * 8,000 or fewer is solved with C(n,k) seeded random draws at 3 plies).
 *
 * Four variants, sharing one engine:
 *   A  visit the DISTINCT opponent hands in a seeded random permutation (sampling without replacement); per candidate accumulate paired differences (running n, sum,
 *      sum of squares) between every pair of candidates, so best-minus-played and top1-minus-top2 are both available; finite-population correction on every interval.
 *   B  sequential stopping: after `minHands`, check every `step`; stop when the confidence interval of (best minus played) lies inside one grade band or its half-width is
 *      under `halfWidth`, or a cap (hands or time) is reached; when the enumeration finishes the result is exact over the hands.
 *   C  candidate racing: drop a candidate once it is clearly beaten by the current best (its paired interval's upper end is below zero at `racingZ`), never the best or the
 *      played move, and stop searching it for the remaining hands.
 *   D  anytime output: a cap or a time budget never yields "no result": the best-so-far verdict is returned with its interval and `partial: true`.
 *
 * The engine runs over a `HandSource`, so the same code runs live (the real game-tree search per hand) and on a recording of every hand's values (the offline study).
 */
import { applyGameCommand, createDeterministicRandom, shuffleDeterministically, type Config, type GameState, type Tile } from '@racehorse/game-core';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { performance } from 'node:perf_hooks';
import { resolveHiddenPoolEligibility } from '../hiddenPoolEligibility';
import { resolveReviewConfig } from '../reviewRuleset';
import { commandForAction, searchGameTree, type GameTreeWalkConfig, type NodeBudget } from '../searchGameTree';
import { BAND_EDGES, canonicalActionKey, gradeOfLoss, type Grade } from './reviewSamplingStudyLib';

export const EXACT_PATH_MAX_STATE_SPACE = 8_000; // EXACT_ENUMERATION_STATE_SPACE_THRESHOLD
export const EXACT_PATH_PLY_DEPTH = 3; // exactBudget.maxPlyDepth

// ---- the hidden-hand universe -----------------------------------------------------------------------------------------------

export type HandUniverse = {
  readonly snapshot: ReviewPositionSnapshotV2;
  readonly eligible: readonly Tile[];
  readonly boneyardOnly: readonly Tile[];
  readonly k: number;
  /** Every distinct opponent hand: indexes into `eligible`. */
  readonly combinations: readonly (readonly number[])[];
  readonly actionKeys: readonly string[];
  readonly playedIndex: number;
};

function combinationsOf(n: number, k: number): number[][] {
  const out: number[][] = [];
  const current: number[] = [];
  const walk = (start: number): void => {
    if (current.length === k) { out.push([...current]); return; }
    for (let i = start; i <= n - (k - current.length); i += 1) { current.push(i); walk(i + 1); current.pop(); }
  };
  walk(0);
  return out;
}

/** The distinct hands of the exact-path decision, or null when the position has no feasible hand or its space is above the exact-path threshold. */
export function buildHandUniverse(snapshot: ReviewPositionSnapshotV2, maxPips = 6): HandUniverse | null {
  const { eligibleForOpponent, excludedTiles } = resolveHiddenPoolEligibility(snapshot, maxPips);
  const k = snapshot.preAction.opponentTileCount;
  if (eligibleForOpponent.length < k || k < 0) return null;
  let space = 1;
  for (let i = 0; i < k; i += 1) space = (space * (eligibleForOpponent.length - i)) / (i + 1);
  space = Math.round(space);
  if (space < 1 || space > EXACT_PATH_MAX_STATE_SPACE) return null;
  const actionKeys = snapshot.legalActions.map(canonicalActionKey);
  return {
    snapshot,
    eligible: eligibleForOpponent,
    boneyardOnly: excludedTiles,
    k,
    combinations: combinationsOf(eligibleForOpponent.length, k),
    actionKeys,
    playedIndex: Math.max(0, actionKeys.indexOf(canonicalActionKey(snapshot.actualAction))),
  };
}

/** The visiting order of the distinct hands: a seeded random permutation (variant A). */
export function handOrder(universe: HandUniverse, seed: string): number[] {
  const indexes = universe.combinations.map((_, i) => i);
  return shuffleDeterministically(indexes, createDeterministicRandom(`${seed}:order`)) as number[];
}

// ---- one hand's values (the real search) ----------------------------------------------------------------------------------

export type HandValues = {
  /** Per legal action: value difference from the decision point at the search's cutoff (NaN for an action not evaluated). */
  readonly d: readonly number[];
  /** Per legal action: game-tree nodes it took. */
  readonly nodes: readonly number[];
  /** Wall time of the whole hand (ms). */
  readonly ms: number;
};

export type HandSource = {
  readonly total: number;
  readonly actions: number;
  readonly playedIndex: number;
  readonly actionKeys: readonly string[];
  /** Values of the i-th visited hand, evaluating only the `alive` actions. */
  hand(i: number, alive: readonly boolean[]): HandValues;
};

/** The live source: runs the production game-tree search (searchGameTree, 3 plies) on each hand, in a seeded random order. */
export function liveHandSource(universe: HandUniverse, seed: string, maxPips = 6, plyDepth = EXACT_PATH_PLY_DEPTH): HandSource {
  const { snapshot } = universe;
  const { actorId, opponentId, handNumber } = snapshot.identifiers;
  const { actorHand, board, scores, consecutivePasses, handOpen } = snapshot.preAction;
  const rootDiff = scores.actor - scores.opponent;
  const config: Config = { ...resolveReviewConfig(snapshot, maxPips), deadTileCount: snapshot.preAction.boneyard.deadCount };
  const walkConfig = {
    shouldStop: undefined,
    actorId,
    opponentId,
    isCutoff: (state: GameState, depth: number) => state.handOver || state.gameOver || depth >= plyDepth,
    leafValue: (state: GameState) => state.players[actorId].score - state.players[opponentId].score,
  } as unknown as GameTreeWalkConfig;
  const order = handOrder(universe, seed);
  const { drawableCount } = snapshot.preAction.boneyard;
  return {
    total: universe.combinations.length,
    actions: snapshot.legalActions.length,
    playedIndex: universe.playedIndex,
    actionKeys: universe.actionKeys,
    hand(i, alive) {
      const started = performance.now();
      const combo = universe.combinations[order[i]!]!;
      const chosen = new Set(combo);
      const opponentHand = combo.map((index) => universe.eligible[index]!);
      const leftover = universe.eligible.filter((_, index) => !chosen.has(index));
      // the boneyard's order is not an opponent-hand question: one seeded shuffle per hand, as the sampler does
      const remaining = shuffleDeterministically([...leftover, ...universe.boneyardOnly], createDeterministicRandom(`${seed}:b${order[i]}`)) as Tile[];
      const drawable = remaining.slice(0, drawableCount);
      const dead = remaining.slice(drawableCount);
      const d: number[] = [];
      const nodes: number[] = [];
      snapshot.legalActions.forEach((action, a) => {
        if (!alive[a]) { d.push(Number.NaN); nodes.push(0); return; }
        const rootState = {
          config,
          playerIds: [actorId, opponentId],
          players: { [actorId]: { id: actorId, hand: actorHand, score: scores.actor }, [opponentId]: { id: opponentId, hand: opponentHand, score: scores.opponent } },
          board,
          boneyard: [...drawable, ...dead],
          deadTiles: dead,
          currentPlayerIndex: 0,
          handNumber,
          handOpen,
          handOver: false,
          gameOver: false,
          winnerId: null,
          consecutivePasses,
          sequence: 0,
        } as unknown as GameState;
        const command = commandForAction(rootState, actorId, action);
        const { state: post } = applyGameCommand(rootState, command);
        const budget: NodeBudget = { count: 0, max: Number.MAX_SAFE_INTEGER };
        const { diff } = searchGameTree(post, 0, walkConfig, budget);
        d.push(diff - rootDiff);
        nodes.push(budget.count);
      });
      return { d, nodes, ms: performance.now() - started };
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

// ---- the engine -----------------------------------------------------------------------------------------------------------

export type BoundedOptions = {
  /** Most hands to visit (the device or server cap); the enumeration is exact when it reaches every hand. */
  readonly maxHands: number;
  /** Wall-clock budget in ms (live) or recorded ms (replay); undefined = none. */
  readonly maxMs?: number;
  readonly minHands?: number;
  readonly step?: number;
  /** z for the stopping interval (1.96 = 95%). */
  readonly z?: number;
  /** Stop when the half-width of (best - played) is under this many points. */
  readonly halfWidth?: number;
  /** Also require the top move resolved: the interval of (top1 - top2) excludes 0 or has half-width under `halfWidth`. */
  readonly requireTopMove?: boolean;
  /** Set false to disable the sequential stopping rule and racing: a pure variant-A pass that ends only at a cap, the time budget or the last hand. */
  readonly earlyStop?: boolean;
  /** Candidate racing (variant C). */
  readonly racing?: boolean;
  /** z for dropping a candidate (2.58 = 99%): deliberately stricter than the stopping interval. */
  readonly racingZ?: number;
};

export type StopReason = 'complete' | 'resolved' | 'cap' | 'time';

export type BoundedResult = {
  readonly handsVisited: number;
  readonly totalHands: number;
  readonly reason: StopReason;
  /** Variant D: true when a cap or the time budget ended it before the answer was resolved or exact. */
  readonly partial: boolean;
  readonly means: readonly number[];
  readonly topIndex: number;
  readonly secondIndex: number | null;
  readonly loss: number;
  /** The interval of (best - played), finite-population corrected; [0, 0] when the played move is the best or every hand was visited. */
  readonly lossInterval: readonly [number, number];
  readonly grade: Grade;
  /** Candidates dropped by racing, and the share of node work that saved (0 to 1). */
  readonly dropped: number;
  readonly nodesSavedShare: number;
  /** Estimated wall ms: the hands' recorded ms, with a dropped candidate's share of its hand's nodes removed. */
  readonly ms: number;
};

type Pair = { n: number; sum: number; sumsq: number };

const bandIndex = (value: number): number => (value <= BAND_EDGES[0] ? 0 : value <= BAND_EDGES[1] ? 1 : value <= BAND_EDGES[2] ? 2 : 3);

export function runBounded(source: HandSource, options: BoundedOptions): BoundedResult {
  const A = source.actions;
  const N = source.total;
  const minHands = options.minHands ?? 20;
  const step = options.step ?? 10;
  const z = options.z ?? 1.96;
  const halfWidth = options.halfWidth ?? 0.25;
  const racingZ = options.racingZ ?? 2.58;
  const cap = Math.min(options.maxHands, N);
  const alive = new Array<boolean>(A).fill(true);
  const sum = new Array<number>(A).fill(0);
  const count = new Array<number>(A).fill(0);
  const pairs: Pair[][] = Array.from({ length: A }, () => Array.from({ length: A }, () => ({ n: 0, sum: 0, sumsq: 0 })));
  let n = 0;
  let ms = 0;
  let nodesAll = 0;
  let nodesSaved = 0;
  let reason: StopReason = 'cap';

  const mean = (a: number) => (count[a]! > 0 ? sum[a]! / count[a]! : Number.NEGATIVE_INFINITY);
  const order = (): number[] => [...Array(A).keys()].filter((a) => alive[a]).sort((a, b) => (mean(b) !== mean(a) ? mean(b) - mean(a) : source.actionKeys[a]! < source.actionKeys[b]! ? -1 : 1));
  // paired difference d_a - d_b over the hands both were evaluated on, with the finite-population correction (N - n) / (N - 1)
  const interval = (a: number, b: number, zz: number): { mean: number; half: number } => {
    const p = a < b ? pairs[a]![b]! : pairs[b]![a]!;
    const sign = a < b ? 1 : -1;
    if (p.n === 0) return { mean: 0, half: Number.POSITIVE_INFINITY };
    const m = (sign * p.sum) / p.n;
    const variance = p.n > 1 ? Math.max(0, (p.sumsq - p.n * m * m) / (p.n - 1)) : 0;
    const fpc = N > 1 ? Math.max(0, (N - p.n) / (N - 1)) : 0;
    return { mean: m, half: zz * Math.sqrt((variance / p.n) * fpc) };
  };

  for (let i = 0; i < N; i += 1) {
    const values = source.hand(i, alive);
    const handNodes = values.nodes.reduce((s, x) => s + x, 0);
    const droppedNodes = values.nodes.reduce((s, x, a) => s + (alive[a] ? 0 : x), 0);
    // a hand's recorded nodes include actions we would have skipped under racing: charge only the alive share of its time
    const aliveNodes = values.nodes.reduce((s, x, a) => s + (alive[a] ? x : 0), 0);
    ms += handNodes > 0 ? values.ms * (aliveNodes / handNodes) : values.ms;
    nodesAll += handNodes;
    nodesSaved += droppedNodes;
    for (let a = 0; a < A; a += 1) {
      if (!alive[a]) continue;
      sum[a]! += values.d[a]!;
      count[a]! += 1;
      for (let b = a + 1; b < A; b += 1) {
        if (!alive[b]) continue;
        const diff = values.d[a]! - values.d[b]!;
        const p = pairs[a]![b]!;
        p.n += 1;
        p.sum += diff;
        p.sumsq += diff * diff;
      }
    }
    n += 1;
    if (n >= N) { reason = 'complete'; break; }
    if (options.maxMs !== undefined && ms >= options.maxMs) { reason = 'time'; break; }
    if (n >= cap) { reason = 'cap'; break; }
    if (options.earlyStop !== false && n >= minHands && (n - minHands) % step === 0) {
      const ranked = order();
      const best = ranked[0]!;
      const second = ranked[1] ?? null;
      const loss = best === source.playedIndex ? { mean: 0, half: 0 } : interval(best, source.playedIndex, z);
      const lo = loss.mean - loss.half;
      const hi = loss.mean + loss.half;
      const lossResolved = loss.half < halfWidth || bandIndex(lo) === bandIndex(hi);
      let topResolved = true;
      if (options.requireTopMove && second !== null) {
        const gap = interval(best, second, z);
        topResolved = gap.half < halfWidth || gap.mean - gap.half > 0;
      }
      if (lossResolved && topResolved) { reason = 'resolved'; break; }
      if (options.racing) {
        for (const a of ranked) {
          if (a === best || a === source.playedIndex || !alive[a]) continue;
          const beaten = interval(a, best, racingZ);
          if (beaten.mean + beaten.half < 0) alive[a] = false;
        }
      }
    }
  }

  const ranked = order();
  const best = ranked[0]!;
  const lossMean = best === source.playedIndex ? 0 : mean(best) - mean(source.playedIndex);
  const lossCI = best === source.playedIndex || reason === 'complete' ? { mean: lossMean, half: 0 } : interval(best, source.playedIndex, z);
  return {
    handsVisited: n,
    totalHands: N,
    reason,
    partial: reason === 'cap' || reason === 'time',
    means: sum.map((_, a) => (count[a]! > 0 ? sum[a]! / count[a]! : Number.NaN)),
    topIndex: best,
    secondIndex: ranked[1] ?? null,
    loss: lossMean,
    lossInterval: [lossMean - lossCI.half, lossMean + lossCI.half],
    grade: gradeOfLoss(lossMean),
    dropped: alive.filter((x) => !x).length,
    nodesSavedShare: nodesAll > 0 ? nodesSaved / nodesAll : 0,
    ms,
  };
}
