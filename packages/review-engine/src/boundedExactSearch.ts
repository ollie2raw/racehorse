import {
  applyGameCommand,
  computePlayScore,
  createDeterministicRandom,
  shuffleDeterministically,
  simulatePlacement,
  type Config,
  type GameState,
  type Tile,
} from '@racehorse/game-core';
import type { ReviewAction, ReviewCandidateEvaluationV1, ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { REVIEW_EVALUATION_VERSION } from '@racehorse/game-core/review';
import { LOSS_BAND_BOUNDARIES } from './accuracyModelCalibration';
import { intervalInsideOneBand } from './gradeBands';
import { WALL_CLOCK_CEILING_DIAGNOSTIC } from './evaluateReviewPosition';
import { resolveHiddenPoolEligibility } from './hiddenPoolEligibility';
import { resolveReviewConfig } from './reviewRuleset';
import { commandForAction, searchGameTree, type GameTreeWalkConfig, type NodeBudget } from './searchGameTree';

/**
 * Bounded exact path (docs/review-bounded-exact-2026-11-07.md, docs/review-bounded-path-prereport-2026-11-07.md). OFF unless the caller passes `boundedExact` to
 * adaptiveEvaluateReviewPosition (the server does so only when REVIEW_BOUNDED_EXACT_ENABLED is "true").
 *
 * What it replaces. The "exact enumeration" branch of adaptiveEvaluateReviewPosition (hidden-hand space C(n,k) of 8,000 or fewer) draws C(n,k) seeded hands WITH
 * replacement, so it sees about 63% of the distinct hands and still pays for all C draws. This visits the DISTINCT hands in a seeded random order (a permutation keyed by the
 * decision id), once each, and:
 *   - stops as soon as the verdict is settled (sequential stopping on the interval of best-minus-played and of the top-move margin);
 *   - stops searching a candidate that is clearly beaten (racing; the best and the played move are never dropped);
 *   - ends at a cap with the best-so-far answer, `partial = true` and a confidence interval, never "no result".
 * A run that visits every hand is exactly the full enumeration (tested against an independent brute force). Nothing here reads a clock for its verdict: the stopping rule is
 * statistical and the only caps are hands and nodes, so the same snapshot gives the same evaluation on any machine (the shared wall-clock ceiling can still cut a run, as it
 * can for every search; that is reported as `wall-clock`).
 *
 * Locked yards (no tiles left to draw) keep the exhaustive-to-the-hand's-end minimax of solveExactEndgame; only the visiting order (random, so a capped answer is an unbiased
 * sample rather than a lexicographic prefix) and the node cap (1,000,000 by default; today's budget is 100,000,000 and is never reached) differ. Without a cap hit it returns
 * exactly what solveExactEndgame returns.
 *
 * No `node:` imports (INV-20): this file runs in the browser bundle's dependency graph too.
 */

export const BOUNDED_EXACT_SEARCH_VERSION = 1;
/** Plies searched below each hidden hand (recorded in `search.depth`); 3 is what the exact-enumeration branch uses today. */
export const BOUNDED_EXACT_PLY_DEPTH = 3;
/** The hidden-hand space the branch handles: the same threshold as EXACT_ENUMERATION_STATE_SPACE_THRESHOLD. */
export const BOUNDED_EXACT_MAX_HANDS = 8_000;
/** Cumulative node cap of a locked-yard decision (about the 180 s worker kill at a machine 40x slower than the measured laptop). */
export const BOUNDED_LOCKED_YARD_NODE_CAP = 1_000_000;
/** The midgame node cap: today's exact-branch budget, never reached in practice. */
export const BOUNDED_MIDGAME_NODE_CAP = 100_000_000;
/** The shared per-decision wall-clock safety ceiling of the branch it replaces (exactBudget.maxWallClockMs). */
export const BOUNDED_WALL_CLOCK_CEILING_MS = 1_800_000;
/** Stand-in for an unbounded side of an interval (JSON cannot carry Infinity). */
export const UNBOUNDED_LOSS = 1_000_000;

/** The tuned stopping rule of docs/review-bounded-exact-2026-11-07.md (Step 3): sequential stopping on loss and top move, racing at 99%. */
export type BoundedExactOptions = {
  readonly plyDepth?: number;
  readonly minHands?: number;
  readonly step?: number;
  /** z of the stopping interval of (best - played) and (top1 - top2). */
  readonly z?: number;
  /** Stop when the half-width of that interval is under this many points. */
  readonly halfWidth?: number;
  readonly requireTopMove?: boolean;
  readonly racing?: boolean;
  readonly racingZ?: number;
  /** Most hands to visit (default: all of them). */
  readonly maxHands?: number;
  readonly midgameNodeCap?: number;
  readonly lockedYardNodeCap?: number;
  readonly wallClockCeilingMs?: number;
};

export const BOUNDED_EXACT_DEFAULTS = {
  plyDepth: BOUNDED_EXACT_PLY_DEPTH,
  minHands: 20,
  step: 10,
  z: 2.58,
  halfWidth: 0.15,
  requireTopMove: true,
  racing: true,
  racingZ: 2.58,
  midgameNodeCap: BOUNDED_MIDGAME_NODE_CAP,
  lockedYardNodeCap: BOUNDED_LOCKED_YARD_NODE_CAP,
  wallClockCeilingMs: BOUNDED_WALL_CLOCK_CEILING_MS,
} as const;

const BAND_EDGES = [LOSS_BAND_BOUNDARIES.bestTolerance, LOSS_BAND_BOUNDARIES.inaccuracyToMistake, LOSS_BAND_BOUNDARIES.mistakeToBlunder] as const;
const bandIndex = (value: number): number => (value <= BAND_EDGES[0] ? 0 : value <= BAND_EDGES[1] ? 1 : value <= BAND_EDGES[2] ? 2 : 3);

/** Two-sided 95% Student t critical value (df 1 to 30; the normal 1.96 beyond), for the interval REPORTED on a result that visited few hands. */
const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042] as const;
export const tCritical95 = (df: number): number => (df < 1 ? Number.POSITIVE_INFINITY : df <= T95.length ? T95[df - 1]! : 1.96);

// ---- the hidden-hand universe -----------------------------------------------------------------------------------------------

export type HandUniverse = {
  readonly snapshot: ReviewPositionSnapshotV2;
  /** Tiles the opponent may hold (canonically ordered: the order solveExactEndgame enumerates in). */
  readonly eligible: readonly Tile[];
  /** Hidden tiles the opponent cannot hold (they are in the boneyard). */
  readonly boneyardOnly: readonly Tile[];
  readonly k: number;
  /** Every distinct opponent hand, as indexes into `eligible`, in lexicographic order. */
  readonly combinations: readonly (readonly number[])[];
  readonly actionKeys: readonly string[];
  readonly playedIndex: number;
};

export function canonicalActionKey(action: ReviewAction): string {
  if (action.kind === 'play') {
    const lo = Math.min(action.tile.low, action.tile.high);
    const hi = Math.max(action.tile.low, action.tile.high);
    return JSON.stringify({ tile: [lo, hi], position: action.position });
  }
  return JSON.stringify({ kind: action.kind });
}

function sortTilesCanonically(tiles: readonly Tile[]): Tile[] {
  return [...tiles].sort((a, b) => Math.min(a.low, a.high) - Math.min(b.low, b.high) || Math.max(a.low, a.high) - Math.max(b.low, b.high));
}

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

/** The distinct hands of a decision, or null when the position has no feasible hand or its space is above the branch's threshold. */
export function buildHandUniverse(snapshot: ReviewPositionSnapshotV2, maxPips = 6): HandUniverse | null {
  const { eligibleForOpponent, excludedTiles } = resolveHiddenPoolEligibility(snapshot, maxPips);
  const k = snapshot.preAction.opponentTileCount;
  if (k < 0 || eligibleForOpponent.length < k) return null;
  let space = 1;
  for (let i = 0; i < k; i += 1) space = (space * (eligibleForOpponent.length - i)) / (i + 1);
  space = Math.round(space);
  if (space < 1 || space > BOUNDED_EXACT_MAX_HANDS) return null;
  const actionKeys = snapshot.legalActions.map(canonicalActionKey);
  return {
    snapshot,
    eligible: sortTilesCanonically(eligibleForOpponent),
    boneyardOnly: excludedTiles,
    k,
    combinations: combinationsOf(eligibleForOpponent.length, k),
    actionKeys,
    playedIndex: Math.max(0, actionKeys.indexOf(canonicalActionKey(snapshot.actualAction))),
  };
}

/** The visiting order of the distinct hands: a seeded random permutation, each hand exactly once. */
export function handOrder(universe: HandUniverse, seed: string): number[] {
  const indexes = universe.combinations.map((_, i) => i);
  return shuffleDeterministically(indexes, createDeterministicRandom(`${seed}:order`)) as number[];
}

/** The seed of a decision's visiting order: keyed by the decision id, so the same decision always walks the hands in the same order, whatever the depth or the caps. */
export const boundedExactSeed = (snapshot: ReviewPositionSnapshotV2): string => `bounded-exact-v${BOUNDED_EXACT_SEARCH_VERSION}:${snapshot.identifiers.decisionId}`;

// ---- one hand's values (the real search) ------------------------------------------------------------------------------------

export type HandValues = {
  /** Per legal action: value difference from the decision point at the search's cutoff (NaN for an action not evaluated). */
  readonly d: readonly number[];
  /** Per legal action: game-tree nodes it took. */
  readonly nodes: readonly number[];
  /** Wall time of the hand (ms); only the offline studies fill it in. */
  readonly ms?: number;
  /** False when a node budget or the wall-clock ceiling cut the hand short: its values are discarded. */
  readonly finished?: boolean;
};

export type HandSource = {
  readonly total: number;
  readonly actions: number;
  readonly playedIndex: number;
  readonly actionKeys: readonly string[];
  /** Values of the i-th visited hand, evaluating only the `alive` actions. */
  hand(i: number, alive: readonly boolean[]): HandValues;
};

type SourceKind = { readonly lockedYard: boolean; readonly plyDepth: number };

/**
 * The live source: the production game-tree search on each hand, in the seeded random order. `budget` is shared across hands (so a cap lands mid-hand, as the solvers it
 * replaces do); a locked yard searches to the hand's end, a midgame to `plyDepth` plies.
 */
export function liveHandSource(
  universe: HandUniverse,
  seed: string,
  kind: SourceKind,
  budget: NodeBudget,
  shouldStop?: () => boolean,
  maxPips = 6,
): HandSource {
  const { snapshot } = universe;
  const { actorId, opponentId, handNumber } = snapshot.identifiers;
  const { actorHand, board, scores, consecutivePasses, handOpen } = snapshot.preAction;
  const rootDiff = scores.actor - scores.opponent;
  const base = resolveReviewConfig(snapshot, maxPips);
  // A midgame position keeps the real boneyard; a locked yard has none to draw from (as in solveMidgameDeterminization / solveExactEndgame).
  const config: Config = kind.lockedYard ? base : { ...base, deadTileCount: snapshot.preAction.boneyard.deadCount };
  const walkConfig: GameTreeWalkConfig = {
    shouldStop,
    actorId,
    opponentId,
    isCutoff: kind.lockedYard
      ? (state) => state.handOver || state.gameOver
      : (state, depth) => state.handOver || state.gameOver || depth >= kind.plyDepth,
    leafValue: (state) => state.players[actorId].score - state.players[opponentId].score,
  };
  const order = handOrder(universe, seed);
  const { drawableCount } = snapshot.preAction.boneyard;
  return {
    total: universe.combinations.length,
    actions: snapshot.legalActions.length,
    playedIndex: universe.playedIndex,
    actionKeys: universe.actionKeys,
    hand(i, alive) {
      const combo = universe.combinations[order[i]!]!;
      const chosen = new Set(combo);
      const opponentHand = combo.map((index) => universe.eligible[index]!);
      const leftover = universe.eligible.filter((_, index) => !chosen.has(index));
      let drawable: Tile[] = [];
      let dead: Tile[];
      if (kind.lockedYard) {
        dead = [...leftover, ...universe.boneyardOnly];
      } else {
        // The boneyard's order is not an opponent-hand question: one seeded shuffle per hand, as the sampler does.
        const remaining = shuffleDeterministically([...leftover, ...universe.boneyardOnly], createDeterministicRandom(`${seed}:b${order[i]}`)) as Tile[];
        drawable = remaining.slice(0, drawableCount);
        dead = remaining.slice(drawableCount);
      }
      const d: number[] = [];
      const nodes: number[] = [];
      let finished = true;
      for (let a = 0; a < snapshot.legalActions.length; a += 1) {
        if (!alive[a]) { d.push(Number.NaN); nodes.push(0); continue; }
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
        const command = commandForAction(rootState, actorId, snapshot.legalActions[a]!);
        const { state: post } = applyGameCommand(rootState, command);
        const before = budget.count;
        const result = searchGameTree(post, 0, walkConfig, budget);
        d.push(result.diff - rootDiff);
        nodes.push(budget.count - before);
        if (!result.finished) { finished = false; break; }
      }
      return { d, nodes, finished };
    },
  };
}

// ---- the engine -----------------------------------------------------------------------------------------------------------

export type BoundedRunOptions = {
  /** Most hands to visit; the enumeration is exact when it reaches every hand. */
  readonly maxHands: number;
  /** Wall-clock budget in ms of the hands' own timing (offline studies only; production leaves it unset). */
  readonly maxMs?: number;
  readonly minHands?: number;
  readonly step?: number;
  readonly z?: number;
  readonly halfWidth?: number;
  readonly requireTopMove?: boolean;
  /** Set false to disable sequential stopping and racing: a pure pass that ends only at a cap or the last hand. */
  readonly earlyStop?: boolean;
  readonly racing?: boolean;
  readonly racingZ?: number;
  /** Checked before each hand; true ends the run as `wall-clock`. */
  readonly shouldStop?: () => boolean;
};

export type StopReason = 'complete' | 'resolved' | 'cap' | 'time' | 'node-cap' | 'wall-clock';

export type BoundedResult = {
  readonly handsVisited: number;
  readonly totalHands: number;
  readonly reason: StopReason;
  /** True when a cap, the node budget or the wall-clock ceiling ended the run before the answer was resolved or exact. */
  readonly partial: boolean;
  /** Per legal action: mean value over the hands it was evaluated on (NaN when none). */
  readonly means: readonly number[];
  /** Candidate indexes, best first: the candidates still racing by mean, then the ones dropped by racing. */
  readonly rank: readonly number[];
  readonly topIndex: number;
  readonly secondIndex: number | null;
  readonly loss: number;
  /** 95% interval of the played move's loss (best minus played), finite-population corrected; [0, 0] when every hand was visited. */
  readonly lossInterval: readonly [number, number];
  readonly dropped: number;
  readonly nodesSavedShare: number;
  readonly ms: number;
};

type Pair = { n: number; sum: number; sumsq: number };

export function runBounded(source: HandSource, options: BoundedRunOptions): BoundedResult {
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
  const byMean = (a: number, b: number) => (mean(b) !== mean(a) ? mean(b) - mean(a) : source.actionKeys[a]! < source.actionKeys[b]! ? -1 : 1);
  const order = (): number[] => [...Array(A).keys()].filter((a) => alive[a]).sort(byMean);
  // paired difference d_a - d_b over the hands both were evaluated on, with the finite-population correction (N - n) / (N - 1)
  const interval = (a: number, b: number, zz: number): { mean: number; half: number } => {
    const p = a < b ? pairs[a]![b]! : pairs[b]![a]!;
    const sign = a < b ? 1 : -1;
    if (p.n === 0) return { mean: 0, half: Number.POSITIVE_INFINITY };
    const m = (sign * p.sum) / p.n;
    const fpc = N > 1 ? Math.max(0, (N - p.n) / (N - 1)) : 0;
    if (p.n < 2) return { mean: m, half: fpc === 0 ? 0 : Number.POSITIVE_INFINITY };
    const variance = Math.max(0, (p.sumsq - p.n * m * m) / (p.n - 1));
    return { mean: m, half: zz * Math.sqrt((variance / p.n) * fpc) };
  };

  for (let i = 0; i < N; i += 1) {
    if (options.shouldStop?.()) { reason = 'wall-clock'; break; }
    const values = source.hand(i, alive);
    if (values.finished === false) { reason = options.shouldStop?.() ? 'wall-clock' : 'node-cap'; break; }
    const handNodes = values.nodes.reduce((s, x) => s + x, 0);
    const droppedNodes = values.nodes.reduce((s, x, a) => s + (alive[a] ? 0 : x), 0);
    // a hand's recorded nodes include actions racing would have skipped: charge only the alive share of its time
    const aliveNodes = values.nodes.reduce((s, x, a) => s + (alive[a] ? x : 0), 0);
    const handMs = values.ms ?? 0;
    ms += handNodes > 0 ? handMs * (aliveNodes / handNodes) : handMs;
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
  const droppedRanked = [...Array(A).keys()].filter((a) => !alive[a]).sort(byMean);
  const rank = [...ranked, ...droppedRanked];
  const best = ranked[0]!;
  const exact = reason === 'complete';
  const lossMean = best === source.playedIndex || count[best]! === 0 ? 0 : mean(best) - mean(source.playedIndex);
  // The interval REPORTED is 95% with a small-sample (t) multiplier; the stopping rule above uses its own z.
  const reportZ = (hands: number) => tCritical95(hands - 1);
  let lossInterval: readonly [number, number];
  if (exact) {
    lossInterval = [lossMean, lossMean];
  } else if (best === source.playedIndex) {
    // The played move is the apparent best: its loss is 0 unless another candidate is truly better, so the upper end is the most any rival could beat it by.
    let hi = 0;
    for (const a of ranked) {
      if (a === best) continue;
      const gap = interval(a, source.playedIndex, reportZ(n));
      hi = Math.max(hi, gap.mean + gap.half);
    }
    lossInterval = [0, Math.min(hi, UNBOUNDED_LOSS)];
  } else {
    const gap = interval(best, source.playedIndex, reportZ(n));
    lossInterval = [Math.max(0, gap.mean - Math.min(gap.half, UNBOUNDED_LOSS)), Math.min(gap.mean + Math.min(gap.half, UNBOUNDED_LOSS), UNBOUNDED_LOSS)];
  }
  return {
    handsVisited: n,
    totalHands: N,
    reason,
    partial: reason === 'cap' || reason === 'time' || reason === 'node-cap' || reason === 'wall-clock',
    means: sum.map((_, a) => (count[a]! > 0 ? sum[a]! / count[a]! : Number.NaN)),
    rank,
    topIndex: best,
    secondIndex: ranked[1] ?? null,
    loss: lossMean,
    lossInterval,
    dropped: alive.filter((x) => !x).length,
    nodesSavedShare: nodesAll > 0 ? nodesSaved / nodesAll : 0,
    ms,
  };
}

// ---- presentation rule -----------------------------------------------------------------------------------------------------

// The band check moved to gradeBands.ts so the cut-result rule (partialSearch.ts) can share it without a cycle; still exported from here.
export { intervalInsideOneBand };

/**
 * Whether a severity badge may be shown for this evaluation: always, except for a PARTIAL result whose loss interval spans more than one grade band (the verdict is then an
 * estimate the review cannot yet place in a band, so it states none). "Partial" is a bounded exact result cut by a cap (`boundedSearch`, #502) or a sampled result cut by the
 * wall-clock ceiling or a node budget (`partialSearch`, REVIEW_CUT_HONESTY_ENABLED). Every other evaluation, including a bounded one that resolved or finished, is unaffected.
 */
export function severityBadgeAllowed(
  evaluation: Pick<ReviewEvaluationV1, 'boundedSearch' | 'partialSearch'>,
  boundaries?: Parameters<typeof intervalInsideOneBand>[1],
): boolean {
  const bounded = evaluation.boundedSearch;
  if (bounded?.partial && !intervalInsideOneBand(bounded.lossInterval, boundaries)) return false;
  const cut = evaluation.partialSearch;
  if (cut?.partial && !intervalInsideOneBand(cut.lossInterval, boundaries)) return false;
  return true;
}

// ---- the evaluation ---------------------------------------------------------------------------------------------------------

function immediatePointsForAction(board: ReviewPositionSnapshotV2['preAction']['board'], config: Config, action: ReviewAction): number {
  if (action.kind !== 'play') return 0;
  return computePlayScore(simulatePlacement(board, action.tile, action.position), config);
}

/** The bounded evaluation of one decision, or null when the position is outside the branch (no feasible hand, or more than 8,000 distinct hands). */
export function evaluateBoundedExact(
  snapshot: ReviewPositionSnapshotV2,
  options: BoundedExactOptions = {},
  now: () => number = () => performance.now(),
): ReviewEvaluationV1 | null {
  const universe = buildHandUniverse(snapshot);
  if (!universe) return null;
  const opts = { ...BOUNDED_EXACT_DEFAULTS, ...options };
  const lockedYard = snapshot.preAction.boneyard.drawableCount === 0;
  const startedAt = now();
  let exceeded = false;
  const shouldStop = () => {
    exceeded ||= now() - startedAt > opts.wallClockCeilingMs;
    return exceeded;
  };
  const budget: NodeBudget = { count: 0, max: lockedYard ? opts.lockedYardNodeCap : opts.midgameNodeCap };
  const seed = boundedExactSeed(snapshot);
  const source = liveHandSource(universe, seed, { lockedYard, plyDepth: opts.plyDepth }, budget, shouldStop);
  const result = runBounded(source, {
    maxHands: opts.maxHands ?? universe.combinations.length,
    // A locked yard is ground truth when it finishes: no early stopping, only the node cap (so a finished run equals solveExactEndgame).
    earlyStop: !lockedYard,
    minHands: opts.minHands,
    step: opts.step,
    z: opts.z,
    halfWidth: opts.halfWidth,
    requireTopMove: opts.requireTopMove,
    racing: opts.racing,
    racingZ: opts.racingZ,
    shouldStop,
  });

  const config = resolveReviewConfig(snapshot, 6);
  const candidates: ReviewCandidateEvaluationV1[] = result.rank.map((a) => ({
    action: snapshot.legalActions[a]!,
    value: { expectedPointDifferential: Number.isNaN(result.means[a]!) ? 0 : result.means[a]!, winProbability: null },
    immediatePoints: immediatePointsForAction(snapshot.preAction.board, config, snapshot.legalActions[a]!),
    principalVariation: [],
  }));
  const best = candidates[0]!;
  const actualKey = JSON.stringify(snapshot.actualAction);
  const played = candidates.find((c) => JSON.stringify(c.action) === actualKey);
  if (!played) throw new Error('evaluateBoundedExact: no candidate matches snapshot.actualAction -- the solver dropped a legal action.');

  // A finished locked yard is the exact solver's answer and says so; everything else is search evidence (second opinions still run on it).
  const exactLabel = lockedYard && !result.partial;
  const evaluation: ReviewEvaluationV1 = {
    evaluationVersion: REVIEW_EVALUATION_VERSION,
    snapshotId: snapshot.identifiers.decisionId,
    rulesVersion: snapshot.rulesVersion,
    reviewEngineVersion: snapshot.reviewEngineVersion,
    evidence: exactLabel
      ? { source: 'exact', confidence: 'high', displayLabel: 'Exact analysis' }
      : { source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' },
    played,
    best,
    candidates,
    loss: {
      expectedPointDifferential: best.value.expectedPointDifferential - played.value.expectedPointDifferential,
      winProbability: null,
    },
    search: {
      nodes: budget.count,
      depth: lockedYard ? 0 : opts.plyDepth,
      hiddenStateSamples: result.handsVisited,
      coverage: result.totalHands > 0 ? result.handsVisited / result.totalHands : 0,
      complete: !result.partial && !exceeded,
    },
    diagnostics: [`bounded-exact: reason=${result.reason} hands=${result.handsVisited}/${result.totalHands} depth=${lockedYard ? 'end-of-hand' : opts.plyDepth}`],
    boundedSearch: {
      stopReason: result.reason,
      partial: result.partial,
      handsVisited: result.handsVisited,
      totalHands: result.totalHands,
      plyDepth: lockedYard ? 0 : opts.plyDepth,
      orderSeed: seed,
      lossInterval: [result.lossInterval[0], result.lossInterval[1]],
      confidence: 0.95,
    },
  };
  return exceeded
    ? { ...evaluation, search: { ...evaluation.search, complete: false }, diagnostics: [...evaluation.diagnostics, WALL_CLOCK_CEILING_DIAGNOSTIC] }
    : evaluation;
}
