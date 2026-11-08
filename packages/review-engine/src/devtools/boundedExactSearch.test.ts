import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyGameCommand, createDeterministicRandom, shuffleDeterministically, type Config, type GameState, type Tile } from '@racehorse/game-core';
import type { ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { WALL_CLOCK_CEILING_DIAGNOSTIC } from '../evaluateReviewPosition';
import { adaptiveEvaluateReviewPosition } from '../adaptiveEvaluateReviewPosition';
import {
  BOUNDED_EXACT_DEFAULTS,
  BOUNDED_LOCKED_YARD_NODE_CAP,
  boundedExactSeed,
  buildHandUniverse,
  evaluateBoundedExact,
  handOrder,
  intervalInsideOneBand,
  severityBadgeAllowed,
} from '../boundedExactSearch';
import { LOSS_BAND_BOUNDARIES } from '../accuracyModelCalibration';
import { resolveReviewConfig } from '../reviewRuleset';
import { commandForAction, searchGameTree, type GameTreeWalkConfig, type NodeBudget } from '../searchGameTree';
import { solveExactEndgame } from '../solveExactEndgame';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/recorded-self-play');
const corpus = replayRecordedSelfPlay(dir).filter(({ evaluation }) => evaluation.candidates.length > 1);

const midgame = corpus
  .map(({ snapshot }) => ({ snapshot, universe: snapshot.preAction.boneyard.drawableCount > 0 ? buildHandUniverse(snapshot) : null }))
  .filter((p): p is { snapshot: ReviewPositionSnapshotV2; universe: NonNullable<ReturnType<typeof buildHandUniverse>> } => p.universe !== null);
const small = midgame.filter((p) => p.universe.combinations.length >= 25 && p.universe.combinations.length <= 60);
const tiny = midgame.filter((p) => p.universe.combinations.length <= 20);
const lockedYards = corpus.filter(({ snapshot }) => snapshot.preAction.boneyard.drawableCount === 0 && buildHandUniverse(snapshot) !== null);
/** The exhaustive solver's answer, once per decision. The corpus outlier (10 legal actions, 8.6 million nodes, about 20 s) is never solved here: it is only run under the 1,000,000-node cap. */
const exactCache = new Map<ReviewPositionSnapshotV2, ReturnType<typeof solveExactEndgame>>();
const exactOf = (snapshot: ReviewPositionSnapshotV2) => {
  if (!exactCache.has(snapshot)) exactCache.set(snapshot, solveExactEndgame(snapshot, { maxNodes: 100_000_000, maxWallClockMs: Infinity }));
  return exactCache.get(snapshot)!;
};
const cheapLockedYards = lockedYards.filter(({ snapshot }) => snapshot.legalActions.length < 10);

/** An independent full enumeration: every distinct hand in lexicographic order (no permutation, no engine), the same per-hand construction, exact integer sums. */
function bruteForceMeans(snapshot: ReviewPositionSnapshotV2, plyDepth: number): { means: number[]; hands: number } {
  const universe = buildHandUniverse(snapshot)!;
  const { actorId, opponentId, handNumber } = snapshot.identifiers;
  const { actorHand, board, scores, consecutivePasses, handOpen } = snapshot.preAction;
  const rootDiff = scores.actor - scores.opponent;
  const config: Config = { ...resolveReviewConfig(snapshot, 6), deadTileCount: snapshot.preAction.boneyard.deadCount };
  const walk = {
    actorId,
    opponentId,
    isCutoff: (state: GameState, depth: number) => state.handOver || state.gameOver || depth >= plyDepth,
    leafValue: (state: GameState) => state.players[actorId].score - state.players[opponentId].score,
  } as unknown as GameTreeWalkConfig;
  const seed = boundedExactSeed(snapshot);
  const totals = snapshot.legalActions.map(() => 0);
  universe.combinations.forEach((combo, j) => {
    const chosen = new Set(combo);
    const opponentHand = combo.map((i) => universe.eligible[i]!);
    const leftover = universe.eligible.filter((_, i) => !chosen.has(i));
    const remaining = shuffleDeterministically([...leftover, ...universe.boneyardOnly], createDeterministicRandom(`${seed}:b${j}`)) as Tile[];
    const drawable = remaining.slice(0, snapshot.preAction.boneyard.drawableCount);
    const dead = remaining.slice(snapshot.preAction.boneyard.drawableCount);
    snapshot.legalActions.forEach((action, a) => {
      const root = {
        config, playerIds: [actorId, opponentId],
        players: { [actorId]: { id: actorId, hand: actorHand, score: scores.actor }, [opponentId]: { id: opponentId, hand: opponentHand, score: scores.opponent } },
        board, boneyard: [...drawable, ...dead], deadTiles: dead, currentPlayerIndex: 0, handNumber, handOpen, handOver: false, gameOver: false, winnerId: null, consecutivePasses, sequence: 0,
      } as unknown as GameState;
      const { state: post } = applyGameCommand(root, commandForAction(root, actorId, action));
      const budget: NodeBudget = { count: 0, max: Number.MAX_SAFE_INTEGER };
      totals[a]! += searchGameTree(post, 0, walk, budget).diff - rootDiff;
    });
  });
  return { means: totals.map((t) => t / universe.combinations.length), hands: universe.combinations.length };
}

const valueOf = (evaluation: ReviewEvaluationV1, action: ReviewEvaluationV1['best']['action']) =>
  evaluation.candidates.find((c) => JSON.stringify(c.action) === JSON.stringify(action))!.value.expectedPointDifferential;

describe('bounded exact path: the contract of a finished run', () => {
  it('has positions to check', () => {
    expect(small.length).toBeGreaterThanOrEqual(3);
    expect(tiny.length).toBeGreaterThanOrEqual(3);
    expect(lockedYards.length).toBeGreaterThanOrEqual(5);
  });

  it('a COMPLETED run equals the full enumeration exactly: every candidate value, the best, the loss, a zero interval', { timeout: 120_000 }, () => {
    for (const { snapshot } of small.slice(0, 3)) {
      // never check the stopping rule (minHands above the hand count), so the run visits every distinct hand
      const evaluation = evaluateBoundedExact(snapshot, { minHands: 1_000_000 })!;
      const truth = bruteForceMeans(snapshot, 3);
      expect(evaluation.boundedSearch!.stopReason).toBe('complete');
      expect(evaluation.boundedSearch!.partial).toBe(false);
      expect(evaluation.boundedSearch!.handsVisited).toBe(truth.hands);
      expect(evaluation.boundedSearch!.totalHands).toBe(truth.hands);
      expect(evaluation.search.complete).toBe(true);
      expect(evaluation.search.coverage).toBe(1);
      snapshot.legalActions.forEach((action, a) => expect(valueOf(evaluation, action)).toBe(truth.means[a]));
      const sorted = [...truth.means].sort((x, y) => y - x);
      expect(evaluation.best.value.expectedPointDifferential).toBe(sorted[0]);
      const playedIndex = snapshot.legalActions.findIndex((action) => JSON.stringify(action) === JSON.stringify(snapshot.actualAction));
      expect(evaluation.loss.expectedPointDifferential).toBe(sorted[0]! - truth.means[playedIndex]!);
      expect(evaluation.boundedSearch!.lossInterval[0]).toBe(evaluation.boundedSearch!.lossInterval[1]);
    }
  });

  it('a position with 20 or fewer distinct hands completes on its own (the stopping rule needs 20 hands) and equals the full enumeration', { timeout: 120_000 }, () => {
    for (const { snapshot } of tiny.slice(0, 3)) {
      const evaluation = evaluateBoundedExact(snapshot)!;
      const truth = bruteForceMeans(snapshot, 3);
      expect(evaluation.boundedSearch!.stopReason).toBe('complete');
      snapshot.legalActions.forEach((action, a) => expect(valueOf(evaluation, action)).toBe(truth.means[a]));
    }
  });

  it('visits the distinct hands in a seeded permutation keyed by the decision id: each hand exactly once, the same for the same id, different for another id', () => {
    for (const { snapshot, universe } of small.slice(0, 3)) {
      const order = handOrder(universe, boundedExactSeed(snapshot));
      expect(order).toHaveLength(universe.combinations.length);
      expect(new Set(order).size).toBe(universe.combinations.length);
      expect(handOrder(universe, boundedExactSeed(snapshot))).toEqual(order);
      const other = { ...snapshot, identifiers: { ...snapshot.identifiers, decisionId: `${snapshot.identifiers.decisionId}-other` } };
      expect(boundedExactSeed(other)).not.toBe(boundedExactSeed(snapshot));
      expect(handOrder(universe, boundedExactSeed(other))).not.toEqual(order);
    }
  });

  it('is deterministic: the same snapshot gives the same evaluation, byte for byte', { timeout: 120_000 }, () => {
    const { snapshot } = small[0]!;
    expect(JSON.stringify(evaluateBoundedExact(snapshot))).toBe(JSON.stringify(evaluateBoundedExact(snapshot)));
  });

  it('records the depth as a parameter in search.depth (3 by default, 2 on request, 0 for a locked yard searched to the hand\'s end)', { timeout: 120_000 }, () => {
    const { snapshot } = small[0]!;
    expect(BOUNDED_EXACT_DEFAULTS.plyDepth).toBe(3);
    expect(evaluateBoundedExact(snapshot)!.search.depth).toBe(3);
    expect(evaluateBoundedExact(snapshot, { plyDepth: 2 })!.search.depth).toBe(2);
    expect(evaluateBoundedExact(snapshot, { plyDepth: 2 })!.boundedSearch!.plyDepth).toBe(2);
    expect(evaluateBoundedExact(lockedYards[0]!.snapshot)!.search.depth).toBe(0);
  });

  it('keeps evidence.source "search" for a midgame decision, whether it finished, resolved early or was cut by a cap', { timeout: 120_000 }, () => {
    const { snapshot } = small[0]!;
    const finished = evaluateBoundedExact(snapshot, { minHands: 1_000_000 })!;
    const capped = evaluateBoundedExact(snapshot, { minHands: 1_000_000, maxHands: 5 })!;
    for (const evaluation of [finished, capped, evaluateBoundedExact(snapshot)!]) {
      expect(evaluation.evidence).toEqual({ source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' });
    }
  });
});

describe('bounded exact path: partial results', () => {
  it('a hand cap ends the run with partial=true, the stop reason, how many hands were seen, and a finite interval that contains the loss', { timeout: 120_000 }, () => {
    for (const { snapshot } of small.slice(0, 3)) {
      const evaluation = evaluateBoundedExact(snapshot, { minHands: 1_000_000, maxHands: 8 })!;
      const bounded = evaluation.boundedSearch!;
      expect(bounded.partial).toBe(true);
      expect(bounded.stopReason).toBe('cap');
      expect(bounded.handsVisited).toBe(8);
      expect(evaluation.search.complete).toBe(false);
      expect(evaluation.search.hiddenStateSamples).toBe(8);
      expect(Number.isFinite(bounded.lossInterval[0]) && Number.isFinite(bounded.lossInterval[1])).toBe(true);
      expect(bounded.lossInterval[0]).toBeLessThanOrEqual(evaluation.loss.expectedPointDifferential + 1e-9);
      expect(bounded.lossInterval[1]).toBeGreaterThanOrEqual(evaluation.loss.expectedPointDifferential - 1e-9);
      expect(bounded.confidence).toBe(0.95);
    }
  });

  it('a run that visited a single hand reports an unbounded interval, not a confident-looking zero width', { timeout: 120_000 }, () => {
    const { snapshot } = small.find((p) => JSON.stringify(p.snapshot.actualAction) !== JSON.stringify(evaluateBoundedExact(p.snapshot, { minHands: 1_000_000, maxHands: 1 })!.best.action))!;
    const evaluation = evaluateBoundedExact(snapshot, { minHands: 1_000_000, maxHands: 1 })!;
    expect(evaluation.boundedSearch!.partial).toBe(true);
    expect(evaluation.boundedSearch!.lossInterval[1] - evaluation.boundedSearch!.lossInterval[0]).toBeGreaterThan(1000);
    expect(severityBadgeAllowed(evaluation)).toBe(false);
  });

  it('a severity badge is allowed for a partial result only when its interval lies inside one grade band', () => {
    const { bestTolerance, inaccuracyToMistake, mistakeToBlunder } = LOSS_BAND_BOUNDARIES;
    const partial = (lossInterval: readonly [number, number]) => ({ boundedSearch: { stopReason: 'cap', partial: true, handsVisited: 5, totalHands: 50, plyDepth: 3, orderSeed: 's', lossInterval, confidence: 0.95 } as const });
    expect(severityBadgeAllowed(partial([0, bestTolerance - 0.01]))).toBe(true); // inside Best
    expect(severityBadgeAllowed(partial([bestTolerance + 0.05, inaccuracyToMistake - 0.05]))).toBe(true); // inside Inaccuracy
    expect(severityBadgeAllowed(partial([inaccuracyToMistake + 0.1, mistakeToBlunder - 0.1]))).toBe(true); // inside Mistake
    expect(severityBadgeAllowed(partial([mistakeToBlunder + 0.5, mistakeToBlunder + 2]))).toBe(true); // inside Blunder
    expect(severityBadgeAllowed(partial([0.05, 0.4]))).toBe(false); // Best into Inaccuracy
    expect(severityBadgeAllowed(partial([0.5, 3]))).toBe(false); // Inaccuracy into Mistake
    expect(severityBadgeAllowed(partial([bestTolerance, 1]))).toBe(false); // the edge belongs to the better band, the far end does not
    expect(severityBadgeAllowed(partial([0, 0]))).toBe(true);
    // a finished (not partial) bounded result, and an evaluation with no bounded field at all, are never held back
    expect(severityBadgeAllowed({ boundedSearch: { ...partial([0.05, 3]).boundedSearch, partial: false } })).toBe(true);
    expect(severityBadgeAllowed({})).toBe(true);
    expect(intervalInsideOneBand([0.2, 0.7])).toBe(true);
    expect(intervalInsideOneBand([0.2, 0.9])).toBe(false);
  });

  it('the wall-clock ceiling still cuts a run: no result is dropped, it is partial, flagged with the shared diagnostic and an unbounded interval', { timeout: 120_000 }, () => {
    const { snapshot } = small[0]!;
    const evaluation = evaluateBoundedExact(snapshot, { wallClockCeilingMs: -1 })!;
    expect(evaluation.boundedSearch!.stopReason).toBe('wall-clock');
    expect(evaluation.boundedSearch!.partial).toBe(true);
    expect(evaluation.search.complete).toBe(false);
    expect(evaluation.diagnostics).toContain(WALL_CLOCK_CEILING_DIAGNOSTIC);
    expect(evaluation.candidates).toHaveLength(snapshot.legalActions.length);
  });
});

describe('bounded exact path: locked yards and the node cap', () => {
  it('the default cap is 1,000,000 nodes', () => {
    expect(BOUNDED_LOCKED_YARD_NODE_CAP).toBe(1_000_000);
    expect(BOUNDED_EXACT_DEFAULTS.lockedYardNodeCap).toBe(1_000_000);
  });

  it('a locked yard that fits under the cap equals solveExactEndgame exactly (candidates, best, nodes, samples) and is still labelled exact', { timeout: 120_000 }, () => {
    const cheap = cheapLockedYards.filter(({ snapshot }) => (exactOf(snapshot)?.nodes ?? Infinity) < 50_000).slice(0, 6);
    expect(cheap.length).toBeGreaterThanOrEqual(3);
    for (const { snapshot } of cheap) {
      const exact = exactOf(snapshot)!;
      const evaluation = evaluateBoundedExact(snapshot)!;
      expect(evaluation.boundedSearch!.partial).toBe(false);
      expect(evaluation.evidence).toEqual({ source: 'exact', confidence: 'high', displayLabel: 'Exact analysis' });
      expect(evaluation.candidates.map((c) => [JSON.stringify(c.action), c.value.expectedPointDifferential])).toEqual(exact.candidates.map((c) => [JSON.stringify(c.action), c.value.expectedPointDifferential]));
      expect(evaluation.search.nodes).toBe(exact.nodes);
      expect(evaluation.search.hiddenStateSamples).toBe(exact.hiddenStateSamples);
      expect(evaluation.search.complete).toBe(true);
    }
  });

  it('a small node cap cuts a locked yard: partial=true, label "search" (never "Exact analysis"), an interval, and the nodes stay at the cap', { timeout: 120_000 }, () => {
    const heavy = cheapLockedYards.find(({ snapshot }) => {
      const nodes = exactOf(snapshot)?.nodes ?? 0;
      return nodes > 30_000 && nodes < 600_000;
    })!;
    expect(heavy).toBeDefined();
    const evaluation = evaluateBoundedExact(heavy.snapshot, { lockedYardNodeCap: 20_000 })!;
    expect(evaluation.boundedSearch!.stopReason).toBe('node-cap');
    expect(evaluation.boundedSearch!.partial).toBe(true);
    expect(evaluation.evidence.source).toBe('search');
    expect(evaluation.search.complete).toBe(false);
    expect(evaluation.search.nodes).toBeGreaterThan(0);
    expect(evaluation.search.nodes).toBeLessThanOrEqual(20_000 + 1);
    expect(evaluation.boundedSearch!.handsVisited).toBeLessThan(evaluation.boundedSearch!.totalHands);
    const [lo, hi] = evaluation.boundedSearch!.lossInterval;
    expect(lo).toBeLessThanOrEqual(hi);
    expect(Number.isFinite(lo) && Number.isFinite(hi)).toBe(true);
  });

  it('the default 1,000,000-node cap stops the corpus outlier (8.6 million nodes to finish) with partial=true and a valid interval', { timeout: 300_000 }, () => {
    const outlier = lockedYards.find(({ snapshot }) => snapshot.legalActions.length === 10 && snapshot.preAction.actorHand.length === 5);
    expect(outlier).toBeDefined();
    const evaluation = evaluateBoundedExact(outlier!.snapshot)!;
    expect(evaluation.boundedSearch!.stopReason).toBe('node-cap');
    expect(evaluation.boundedSearch!.partial).toBe(true);
    expect(evaluation.search.nodes).toBeLessThanOrEqual(BOUNDED_LOCKED_YARD_NODE_CAP + 1);
    expect(evaluation.search.nodes).toBeGreaterThan(BOUNDED_LOCKED_YARD_NODE_CAP * 0.5);
    expect(evaluation.evidence.source).toBe('search');
    expect(evaluation.boundedSearch!.handsVisited).toBeGreaterThanOrEqual(1);
    expect(evaluation.boundedSearch!.handsVisited).toBeLessThan(evaluation.boundedSearch!.totalHands);
    expect(evaluation.boundedSearch!.lossInterval[0]).toBeLessThanOrEqual(evaluation.boundedSearch!.lossInterval[1]);
  });
});

describe('bounded exact path inside adaptiveEvaluateReviewPosition', () => {
  it('second opinions still run on bounded results (completion phase, search evidence, tiles left to draw), and not in the live phase', { timeout: 300_000 }, () => {
    let withOpinion = 0;
    for (const { snapshot } of small.slice(0, 6)) {
      const off = adaptiveEvaluateReviewPosition(snapshot, { phase: 'completion' });
      const on = adaptiveEvaluateReviewPosition(snapshot, { phase: 'completion', boundedExact: {} });
      expect(on.evaluation.boundedSearch).toBeDefined();
      expect(on.evaluation.evidence.source).toBe('search');
      expect(on.lifecycle).toBe('SCORED');
      expect(on.convergenceReason).toMatch(/^bounded-/);
      // whenever the unbounded path attaches a second opinion, the bounded one does too
      expect(on.evaluation.secondOpinion === undefined).toBe(off.evaluation.secondOpinion === undefined);
      if (on.evaluation.secondOpinion) {
        withOpinion += 1;
        expect(['confirmed', 'unconfirmed']).toContain(on.evaluation.secondOpinion.verdict);
      }
      expect(adaptiveEvaluateReviewPosition(snapshot, { phase: 'live', boundedExact: {} }).evaluation.secondOpinion).toBeUndefined();
    }
    expect(withOpinion).toBeGreaterThanOrEqual(3);
  });

  it('a position outside the branch (more than 8,000 hands, the ladder) is untouched by the option', { timeout: 120_000 }, () => {
    const ladder = corpus.find(({ snapshot }) => snapshot.preAction.boneyard.drawableCount > 0 && buildHandUniverse(snapshot) === null)!;
    const plain = adaptiveEvaluateReviewPosition(ladder.snapshot, { phase: 'completion', maxTier: 1 });
    const flagged = adaptiveEvaluateReviewPosition(ladder.snapshot, { phase: 'completion', maxTier: 1, boundedExact: {} });
    expect(JSON.stringify(flagged)).toBe(JSON.stringify(plain));
    expect(flagged.evaluation.boundedSearch).toBeUndefined();
  });

  it('without the option the exact branch is the draws-with-replacement path it always was (no bounded field, reason exact-complete)', { timeout: 120_000 }, () => {
    const { snapshot } = small[0]!;
    const off = adaptiveEvaluateReviewPosition(snapshot, { phase: 'completion' });
    expect(off.evaluation.boundedSearch).toBeUndefined();
    expect(off.convergenceReason).toBe('exact-complete');
    expect(JSON.stringify(adaptiveEvaluateReviewPosition(snapshot, { phase: 'completion', boundedExact: undefined }))).toBe(JSON.stringify(off));
  });
});
