import { describe, expect, it } from 'vitest';
import type {
  ReviewAction,
  ReviewCandidateEvaluationV1,
  ReviewEvaluationV1,
  ReviewPositionSnapshotV2,
} from '@racehorse/game-core/review';
import type { PlacementPosition } from '@racehorse/game-core/types';
import type { ReviewCoachingFacts } from './reviewCoachingFacts';
import {
  createReviewCoachingFactsResolver,
  measureReviewCoachingFactsInvocations,
  type ReviewCoachingFactsBuildFn,
} from './reviewCoachingFactsResolver';
import { createReviewCoachingFactsStore } from '../modules/review/reviewCoachingFactsStore';
import { buildReviewCoachingProse } from './reviewCoachingProse';
import type { FritzSecondOpinion } from './reviewFritzSecondOpinion';

const play = (low: number, high: number, position: PlacementPosition = 'left'): ReviewAction => ({
  kind: 'play',
  tile: { low, high },
  position,
});

function candidate(
  action: ReviewAction,
  overrides: Partial<ReviewCandidateEvaluationV1> = {},
): ReviewCandidateEvaluationV1 {
  return {
    action,
    value: { expectedPointDifferential: 0, winProbability: null },
    immediatePoints: 0,
    principalVariation: [],
    ...overrides,
  };
}

function evaluation(args: {
  snapshotId: string;
  candidates: readonly ReviewCandidateEvaluationV1[];
  playedAction: ReviewAction;
  bestAction?: ReviewAction;
}): ReviewEvaluationV1 {
  const played = args.candidates.find((c) => JSON.stringify(c.action) === JSON.stringify(args.playedAction))!;
  const best = args.bestAction
    ? args.candidates.find((c) => JSON.stringify(c.action) === JSON.stringify(args.bestAction))!
    : args.candidates[0];
  return {
    evaluationVersion: 1,
    snapshotId: args.snapshotId,
    rulesVersion: 1,
    reviewEngineVersion: 'review-engine-v1',
    evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' },
    played,
    best,
    candidates: args.candidates,
    loss: {
      expectedPointDifferential: best.value.expectedPointDifferential - played.value.expectedPointDifferential,
      winProbability: null,
    },
    search: { nodes: args.candidates.length, depth: 0, hiddenStateSamples: 0, coverage: 1, complete: false },
    diagnostics: [],
  };
}

function snapshot(decisionId: string): ReviewPositionSnapshotV2 {
  return { identifiers: { decisionId } } as unknown as ReviewPositionSnapshotV2;
}

describe('createReviewCoachingFactsResolver — intra-review consistency', () => {
  const actionA = play(1, 2);
  const actionB = play(3, 4);
  const actionAlt = play(5, 6);

  function makeFritzBackedBuilder(
    fritzFn: () => FritzSecondOpinion,
  ): { buildFacts: ReviewCoachingFactsBuildFn; fritzCalls: { count: number } } {
    const fritzCalls = { count: 0 };
    const buildFacts: ReviewCoachingFactsBuildFn = (evaluation, snap, enable = true) => {
      // Mirrors production: Fritz second opinion only when positional path + snapshot.
      const fritz = enable && snap ? (() => {
        fritzCalls.count += 1;
        return fritzFn();
      })() : null;
      const reference = fritz?.action ?? evaluation.best.action;
      return {
        played: { action: evaluation.played.action, immediatePoints: evaluation.played.immediatePoints },
        best: { action: reference, immediatePoints: fritz?.immediatePoints ?? evaluation.best.immediatePoints },
        missKind: 'better_tile',
        deltas: {
          immediatePoints: 0,
          expectedPointDifferential: evaluation.loss.expectedPointDifferential,
        },
        evidence: evaluation.evidence,
        principalVariation: evaluation.best.principalVariation,
        referenceSource: fritz ? 'fritz' : 'oracle',
        agreement: {
          oracleVsFritz: fritz ? 'disagree' : 'not-computed',
          playedMatch: 'neither',
          contested: Boolean(fritz),
        },
        ...(fritz
          ? {
              fritzMove: fritz,
              oracleMove: {
                action: evaluation.best.action,
                immediatePoints: evaluation.best.immediatePoints,
              },
            }
          : {}),
      };
    };
    return { buildFacts, fritzCalls };
  }

  function setup(reviewIdentity: string, fritzFn: () => FritzSecondOpinion) {
    const evalA = evaluation({
      snapshotId: 'a',
      candidates: [candidate(actionA), candidate(actionB)],
      playedAction: actionA,
      bestAction: actionB,
    });
    const evalB = evaluation({
      snapshotId: 'b',
      candidates: [candidate(actionA), candidate(actionB)],
      playedAction: actionB,
      bestAction: actionA,
    });
    const snapA = snapshot('d-a');
    const snapB = snapshot('d-b');
    const { buildFacts, fritzCalls } = makeFritzBackedBuilder(fritzFn);
    const store = createReviewCoachingFactsStore<ReviewCoachingFacts>(reviewIdentity);
    const resolver = createReviewCoachingFactsResolver({
      store,
      getEvaluation: (id) => (id === 'd-a' ? evalA : id === 'd-b' ? evalB : undefined),
      getSnapshot: (id) => (id === 'd-a' ? snapA : id === 'd-b' ? snapB : undefined),
      eligibleDecisionIds: ['d-a', 'd-b'],
      buildFacts,
      enablePositionalExplanations: true,
    });
    return { store, resolver, fritzCalls };
  }

  it('A: same decision requested twice constructs once and returns identical facts', () => {
    const { resolver, fritzCalls } = setup('review-1', () => ({
      action: actionB,
      immediatePoints: 0,
      isMinimaxEndgame: false,
    }));
    const first = resolver.getFacts('d-a');
    const second = resolver.getFacts('d-a');
    expect(fritzCalls.count).toBe(1);
    expect(first).toBe(second);
    expect(first?.agreement?.contested).toBe(true);
    expect(resolver.getInvocationStats().duplicateConstructions).toBe(0);
  });

  it('B: cursor A → B → A does not invoke Fritz again for A', () => {
    let call = 0;
    const { resolver, fritzCalls } = setup('review-1', () => {
      call += 1;
      return call === 1
        ? { action: actionB, immediatePoints: 1, isMinimaxEndgame: false }
        : call === 2
          ? { action: actionA, immediatePoints: 2, isMinimaxEndgame: false }
          : { action: actionAlt, immediatePoints: 99, isMinimaxEndgame: false };
    });
    const a1 = resolver.getFacts('d-a');
    const b1 = resolver.getFacts('d-b');
    const a2 = resolver.getFacts('d-a');
    expect(fritzCalls.count).toBe(2);
    expect(a2).toBe(a1);
    expect(a2?.fritzMove?.action).toEqual(actionB);
    expect(b1?.fritzMove?.action).toEqual(actionA);
    expect(a2?.agreement).toEqual(a1?.agreement);
  });

  it('C: reselect same decision does not construct again', () => {
    const { resolver, fritzCalls } = setup('review-1', () => ({
      action: actionB,
      immediatePoints: 0,
      isMinimaxEndgame: false,
    }));
    resolver.getFacts('d-a');
    resolver.getFacts('d-a');
    resolver.getFacts('d-a');
    expect(fritzCalls.count).toBe(1);
    expect(resolver.getInvocationStats().constructions).toBe(1);
  });

  it('D: two different decision IDs may each invoke Fritz once', () => {
    const { resolver, fritzCalls } = setup('review-1', () => ({
      action: actionB,
      immediatePoints: 0,
      isMinimaxEndgame: false,
    }));
    resolver.getFacts('d-a');
    resolver.getFacts('d-b');
    expect(fritzCalls.count).toBe(2);
  });

  it('E: new review instance with the same decision ID does not leak cache', () => {
    let call = 0;
    const fritzFn = () => {
      call += 1;
      return call === 1
        ? { action: actionB, immediatePoints: 0, isMinimaxEndgame: false }
        : { action: actionAlt, immediatePoints: 7, isMinimaxEndgame: false };
    };
    const first = setup('review-1', fritzFn);
    const a1 = first.resolver.getFacts('d-a');
    const second = setup('review-2', fritzFn);
    const a2 = second.resolver.getFacts('d-a');
    expect(first.fritzCalls.count + second.fritzCalls.count).toBe(2);
    expect(a1?.fritzMove?.action).toEqual(actionB);
    expect(a2?.fritzMove?.action).toEqual(actionAlt);
    expect(a1).not.toBe(a2);
  });

  it('F: alternating Fritz mock stays stable through the resolver', () => {
    let flip = 0;
    const fritzFn = () => {
      flip += 1;
      return flip % 2 === 1
        ? { action: actionB, immediatePoints: 0, isMinimaxEndgame: false }
        : { action: actionAlt, immediatePoints: 0, isMinimaxEndgame: false };
    };
    const { buildFacts } = makeFritzBackedBuilder(fritzFn);
    const evalX = evaluation({
      snapshotId: 'a',
      candidates: [candidate(actionA), candidate(actionB), candidate(actionAlt)],
      playedAction: actionA,
      bestAction: actionB,
    });
    const snap = snapshot('d-a');
    const withoutOwnerFirst = buildFacts(evalX, snap, true);
    const withoutOwnerSecond = buildFacts(evalX, snap, true);
    expect(withoutOwnerFirst.fritzMove?.action).not.toEqual(withoutOwnerSecond.fritzMove?.action);

    flip = 0;
    const { resolver } = setup('review-stable', fritzFn);
    const a1 = resolver.getFacts('d-a');
    const a2 = resolver.getFacts('d-a');
    expect(a1?.fritzMove?.action).toEqual(actionB);
    expect(a2?.fritzMove?.action).toEqual(actionB);
    expect(a1).toBe(a2);
  });

  it('G: repeated prose from canonical facts is identical', () => {
    const { resolver } = setup('review-1', () => ({
      action: actionB,
      immediatePoints: 0,
      isMinimaxEndgame: false,
    }));
    const facts = resolver.getFacts('d-a')!;
    const prose1 = buildReviewCoachingProse(facts, true);
    const prose2 = buildReviewCoachingProse(facts, true);
    expect(prose1).toEqual(prose2);
  });

  it('H: ship constant is approved; callers must still pass an explicit enable', async () => {
    const { REVIEW_POSITIONAL_EXPLANATIONS_ENABLED } = await import('./reviewCoachingFacts');
    expect(REVIEW_POSITIONAL_EXPLANATIONS_ENABLED).toBe(true);
  });

  it('measurement: duplicate constructions are 0 after double-request pass', () => {
    const { resolver, fritzCalls } = setup('review-measure', () => ({
      action: actionB,
      immediatePoints: 0,
      isMinimaxEndgame: false,
    }));
    const stats = measureReviewCoachingFactsInvocations(resolver, ['d-a', 'd-b']);
    expect(stats.eligibleDecisionCount).toBe(2);
    expect(stats.uniqueDecisionsRequested).toBe(2);
    expect(stats.factRequests).toBe(4);
    expect(stats.constructions).toBe(2);
    expect(stats.duplicateFactRequests).toBe(2);
    expect(stats.duplicateConstructions).toBe(0);
    expect(fritzCalls.count).toBe(2);
  });
});
