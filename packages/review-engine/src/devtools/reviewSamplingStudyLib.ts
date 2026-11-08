/**
 * Offline sampling study support (docs/review-performance-measurement-2026-11-07.md, Phase B). NOT production code and not imported by it.
 *
 * `solveMidgameDeterminization` returns only per-action TOTALS over the sampled hidden hands. A standard-error stopping rule needs the per-sample values (for the
 * variance of the paired difference between two actions), so this replays the solver's sampling loop (same sub-seeds `${seed}:${i}`, same root state, same game-tree
 * walk, same cumulative node budget) and records every sample's per-action value and the cumulative node count after it. Because the sub-seeds are a fixed prefix
 * sequence, ONE pass at the 2,500-sample cap yields the result of every smaller budget N as a prefix: samples 0..N-1, kept while the cumulative nodes stay within
 * the tier's proportional node budget (N * 2,000, the ratio of every tier in SEARCH_ESCALATION_TIERS). `runSamplePass` is verified against the real solver in
 * reviewSamplingStudyLib.test.ts, so what it reports is what production would compute.
 */
import type { Config, GameState, Tile } from '@racehorse/game-core';
import { applyGameCommand } from '@racehorse/game-core';
import type { ReviewAction, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { performance } from 'node:perf_hooks';
import { LOSS_BAND_BOUNDARIES } from '../accuracyModelCalibration';
import { resolveHiddenPoolEligibility } from '../hiddenPoolEligibility';
import { resolveReviewConfig } from '../reviewRuleset';
import { sampleHiddenAllocation } from '../sampleHiddenAllocation';
import { commandForAction, searchGameTree, type GameTreeWalkConfig, type NodeBudget } from '../searchGameTree';

/** Nodes per sampled hand in every tier of SEARCH_ESCALATION_TIERS (200,000 / 100 = 5,000,000 / 2,500 = 2,000). */
export const NODES_PER_SAMPLE = 2_000;
export const MAX_PLY_DEPTH = 2;

export function canonicalActionKey(action: ReviewAction): string {
  if (action.kind === 'play') {
    const lo = Math.min(action.tile.low, action.tile.high);
    const hi = Math.max(action.tile.low, action.tile.high);
    return JSON.stringify({ tile: [lo, hi], position: action.position });
  }
  return JSON.stringify({ kind: action.kind });
}

function buildRootState(snapshot: ReviewPositionSnapshotV2, opponentHand: readonly Tile[], boneyardDrawable: readonly Tile[], boneyardDead: readonly Tile[], config: Config): GameState {
  const { actorId, opponentId, handNumber } = snapshot.identifiers;
  const { actorHand, board, scores, consecutivePasses, handOpen } = snapshot.preAction;
  return {
    config,
    playerIds: [actorId, opponentId],
    players: {
      [actorId]: { id: actorId, hand: actorHand, score: scores.actor },
      [opponentId]: { id: opponentId, hand: opponentHand, score: scores.opponent },
    },
    board,
    boneyard: [...boneyardDrawable, ...boneyardDead],
    deadTiles: boneyardDead,
    currentPlayerIndex: 0,
    handNumber,
    handOpen,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses,
    sequence: 0,
  } as GameState;
}

export type SamplePass = {
  /** Per sample, per legal action (in snapshot.legalActions order): the value difference from the decision point, as the solver accumulates it. */
  readonly perSample: readonly (readonly number[])[];
  /** Cumulative game-tree nodes after each solved sample. */
  readonly cumNodes: readonly number[];
  /** Wall time of each solved sample (ms), for costing a stopping rule. */
  readonly msPerSample: readonly number[];
  readonly actionKeys: readonly string[];
  /** Index of the action the player actually played in `actionKeys`. */
  readonly playedIndex: number;
};

/** One pass at the cap; null when the position has no feasible hidden allocation (the solver returns null too). */
export function runSamplePass(
  snapshot: ReviewPositionSnapshotV2,
  seed: string,
  cap: number,
  maxPips = 6,
  /** Ply depth of the walk (default: the ladder's 2). With a depth other than 2 the proportional node budget is lifted, so every one of the `cap` samples is solved. */
  plyDepth: number = MAX_PLY_DEPTH,
): SamplePass | null {
  const { actorId, opponentId } = snapshot.identifiers;
  const { scores } = snapshot.preAction;
  const rootDiff = scores.actor - scores.opponent;
  const { eligibleForOpponent } = resolveHiddenPoolEligibility(snapshot, maxPips);
  if (eligibleForOpponent.length < snapshot.preAction.opponentTileCount) return null;

  const config: Config = { ...resolveReviewConfig(snapshot, maxPips), deadTileCount: snapshot.preAction.boneyard.deadCount };
  const nodeBudget: NodeBudget = { count: 0, max: plyDepth === MAX_PLY_DEPTH ? cap * NODES_PER_SAMPLE : Number.MAX_SAFE_INTEGER };
  const walkConfig: GameTreeWalkConfig = {
    shouldStop: undefined,
    actorId,
    opponentId,
    isCutoff: (state, depth) => state.handOver || state.gameOver || depth >= plyDepth,
    leafValue: (state) => state.players[actorId].score - state.players[opponentId].score,
  } as GameTreeWalkConfig;

  const perSample: number[][] = [];
  const cumNodes: number[] = [];
  const msPerSample: number[] = [];
  for (let i = 0; i < cap; i += 1) {
    const started = performance.now();
    const allocation = sampleHiddenAllocation(snapshot, `${seed}:${i}`, maxPips);
    if (allocation === null) throw new Error('sampleHiddenAllocation returned null despite feasibility');
    const diffs: number[] = [];
    let sampleComplete = true;
    for (const action of snapshot.legalActions) {
      const rootState = buildRootState(snapshot, allocation.opponentHand, allocation.boneyardDrawable, allocation.boneyardDead, config);
      const command = commandForAction(rootState, actorId, action);
      const { state: postActionState } = applyGameCommand(rootState, command);
      const { finished, diff } = searchGameTree(postActionState, 0, walkConfig, nodeBudget);
      diffs.push(diff - rootDiff);
      if (!finished) sampleComplete = false;
    }
    if (!sampleComplete) break; // the solver discards the partial sample and stops
    perSample.push(diffs);
    cumNodes.push(nodeBudget.count);
    msPerSample.push(performance.now() - started);
  }
  const actionKeys = snapshot.legalActions.map(canonicalActionKey);
  const playedKey = canonicalActionKey(snapshot.actualAction);
  const playedIndex = Math.max(0, actionKeys.indexOf(playedKey));
  return { perSample, cumNodes, msPerSample, actionKeys, playedIndex };
}

/** How many samples budget N would have solved: at most N, and only while the cumulative nodes stay within N * NODES_PER_SAMPLE. */
export function solvedAt(pass: SamplePass, n: number): number {
  const limit = n * NODES_PER_SAMPLE;
  let solved = 0;
  while (solved < n && solved < pass.perSample.length && pass.cumNodes[solved]! <= limit) solved += 1;
  return solved;
}

export type Grade = 'best' | 'inaccuracy' | 'mistake' | 'blunder';
export const GRADES: readonly Grade[] = ['best', 'inaccuracy', 'mistake', 'blunder'];
export const BAND_EDGES = [LOSS_BAND_BOUNDARIES.bestTolerance, LOSS_BAND_BOUNDARIES.inaccuracyToMistake, LOSS_BAND_BOUNDARIES.mistakeToBlunder] as const;

export function gradeOfLoss(loss: number): Grade {
  if (loss <= BAND_EDGES[0]) return 'best';
  if (loss <= BAND_EDGES[1]) return 'inaccuracy';
  if (loss <= BAND_EDGES[2]) return 'mistake';
  return 'blunder';
}

export type Verdict = { readonly topIndex: number; readonly secondIndex: number | null; readonly loss: number; readonly grade: Grade; readonly samples: number };

/** The verdict from the first `n` samples: means per action, ordered like the solver (value descending, then canonical key). */
export function verdictAtSamples(pass: SamplePass, n: number): Verdict {
  const count = Math.min(n, pass.perSample.length);
  const actions = pass.actionKeys.length;
  const totals = new Array<number>(actions).fill(0);
  for (let i = 0; i < count; i += 1) for (let a = 0; a < actions; a += 1) totals[a]! += pass.perSample[i]![a]!;
  const mean = (a: number) => (count > 0 ? totals[a]! / count : 0);
  const order = [...pass.actionKeys.keys()].sort((a, b) => (mean(b) !== mean(a) ? mean(b) - mean(a) : pass.actionKeys[a]! < pass.actionKeys[b]! ? -1 : 1));
  const loss = mean(order[0]!) - mean(pass.playedIndex);
  return { topIndex: order[0]!, secondIndex: order[1] ?? null, loss, grade: gradeOfLoss(loss), samples: count };
}

/** Verdict of budget N exactly as the tier-N dispatch would compute it (prefix of the pass, node-capped). */
export const verdictAtBudget = (pass: SamplePass, n: number): Verdict => verdictAtSamples(pass, solvedAt(pass, n));

// ---- statistics ---------------------------------------------------------------------------------------------------

/** Cohen's kappa between two label sequences over the four grades. */
export function cohensKappa(a: readonly Grade[], b: readonly Grade[]): number | null {
  if (a.length === 0) return null;
  const n = a.length;
  let agree = 0;
  const pa = new Map<Grade, number>();
  const pb = new Map<Grade, number>();
  for (let i = 0; i < n; i += 1) {
    if (a[i] === b[i]) agree += 1;
    pa.set(a[i]!, (pa.get(a[i]!) ?? 0) + 1);
    pb.set(b[i]!, (pb.get(b[i]!) ?? 0) + 1);
  }
  const observed = agree / n;
  let expected = 0;
  for (const grade of GRADES) expected += ((pa.get(grade) ?? 0) / n) * ((pb.get(grade) ?? 0) / n);
  return expected >= 1 ? null : (observed - expected) / (1 - expected);
}

/** A small deterministic PRNG (mulberry32) so bootstrap intervals are reproducible. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Percentile bootstrap 95% interval of `statistic` over `items` (2,000 resamples, fixed seed). */
export function bootstrapInterval<T>(items: readonly T[], statistic: (sample: readonly T[]) => number | null, resamples = 2000, seed = 12345): { point: number | null; lo: number | null; hi: number | null } {
  const point = statistic(items);
  if (items.length < 2) return { point, lo: null, hi: null };
  const random = rng(seed);
  const values: number[] = [];
  for (let r = 0; r < resamples; r += 1) {
    const sample = Array.from({ length: items.length }, () => items[Math.floor(random() * items.length)]!);
    const value = statistic(sample);
    if (value !== null && Number.isFinite(value)) values.push(value);
  }
  values.sort((a, b) => a - b);
  if (values.length === 0) return { point, lo: null, hi: null };
  return { point, lo: values[Math.floor(0.025 * values.length)]!, hi: values[Math.min(values.length - 1, Math.floor(0.975 * values.length))]! };
}

export const fraction = (hits: readonly boolean[]): number | null => (hits.length === 0 ? null : hits.filter(Boolean).length / hits.length);
export const meanOf = (values: readonly number[]): number | null => (values.length === 0 ? null : values.reduce((s, x) => s + x, 0) / values.length);
export const quantile = (values: readonly number[], q: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
};
export const formatInterval = (r: { point: number | null; lo: number | null; hi: number | null }, digits = 1): string =>
  r.point === null ? 'n/a' : `${(r.point * 100).toFixed(digits)}% [${r.lo === null ? '?' : (r.lo * 100).toFixed(digits)}, ${r.hi === null ? '?' : (r.hi * 100).toFixed(digits)}]`;
