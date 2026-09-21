import { describe, expect, it, vi } from 'vitest';
import type { ReviewAction, ReviewCandidateEvaluationV1, ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import type { PlacementPosition } from '@racehorse/game-core/types';
import { REVIEW_FIXTURE_CORPUS } from '../../../packages/game-core/src/reviewFixtureCorpus';
import { evaluateReviewPosition } from '../../../packages/review-engine/src/evaluateReviewPosition';
import { buildReviewCoachingProse } from './reviewCoachingProse';
import { buildReviewCoachingFacts } from './reviewCoachingFacts';

const fritzReferenceSpy = vi.hoisted(() => vi.fn(() => {
  throw new Error('Fritz must not run while positional explanations are disabled.');
}));

vi.mock('./reviewFritzSecondOpinion', () => ({ computeFritzReferenceMove: fritzReferenceSpy }));

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
  candidates: readonly ReviewCandidateEvaluationV1[];
  playedAction: ReviewAction;
  bestAction?: ReviewAction;
  evidence?: ReviewEvaluationV1['evidence'];
  winProbability?: number | null;
}): ReviewEvaluationV1 {
  const played = args.candidates.find((c) => JSON.stringify(c.action) === JSON.stringify(args.playedAction))!;
  const best = args.bestAction
    ? args.candidates.find((c) => JSON.stringify(c.action) === JSON.stringify(args.bestAction))!
    : args.candidates[0];
  return {
    evaluationVersion: 1,
    snapshotId: 'x',
    rulesVersion: 1,
    reviewEngineVersion: 'review-engine-v1',
    evidence: args.evidence ?? { source: 'exact', confidence: 'high', displayLabel: 'Exact analysis' },
    played,
    best,
    candidates: args.candidates,
    loss: {
      expectedPointDifferential: best.value.expectedPointDifferential - played.value.expectedPointDifferential,
      winProbability: args.winProbability ?? null,
    },
    search: { nodes: args.candidates.length, depth: 0, hiddenStateSamples: 0, coverage: 1, complete: true },
    diagnostics: [],
  };
}

describe('buildReviewCoachingFacts -- structural missKinds (tier-agnostic)', () => {
  it('forced: a single legal action', () => {
    const action = play(0, 0);
    const evalOut = evaluation({ candidates: [candidate(action)], playedAction: action });
    const facts = buildReviewCoachingFacts(evalOut);
    expect(facts.missKind).toBe('forced');
    expect(facts.played.action).toEqual(action);
    expect(facts.best.action).toEqual(action);
  });

  it('same_tile_wrong_end: multiple legal placements of one tile are a real choice', () => {
    const played = play(2, 6, 'branch-1-0');
    const candidates = [candidate(play(2, 6, 'right'), { value: { expectedPointDifferential: 5, winProbability: null } }), candidate(played)];
    const evalOut = evaluation({ candidates, playedAction: played, bestAction: play(2, 6, 'right') });
    const facts = buildReviewCoachingFacts(evalOut);
    expect(facts.missKind).toBe('same_tile_wrong_end');
  });

  it('pass_or_draw: played a non-play action when a play was available (and best)', () => {
    const played: ReviewAction = { kind: 'pass' };
    const best = play(3, 4);
    const candidates = [
      candidate(played, { value: { expectedPointDifferential: 0, winProbability: null } }),
      candidate(best, { value: { expectedPointDifferential: 10, winProbability: null }, immediatePoints: 15 }),
    ];
    const evalOut = evaluation({ candidates, playedAction: played, bestAction: best });
    const facts = buildReviewCoachingFacts(evalOut);
    expect(facts.missKind).toBe('pass_or_draw');
  });

  it('pass_or_draw: played a play action when pass/draw was actually best', () => {
    const played = play(1, 2);
    const best: ReviewAction = { kind: 'draw' };
    const candidates = [
      candidate(played, { value: { expectedPointDifferential: 0, winProbability: null } }),
      candidate(best, { value: { expectedPointDifferential: 8, winProbability: null } }),
    ];
    const evalOut = evaluation({ candidates, playedAction: played, bestAction: best });
    const facts = buildReviewCoachingFacts(evalOut);
    expect(facts.missKind).toBe('pass_or_draw');
  });

  it('pass_or_draw: pass vs draw mismatch (both non-play)', () => {
    const played: ReviewAction = { kind: 'pass' };
    const best: ReviewAction = { kind: 'draw' };
    const candidates = [
      candidate(played, { value: { expectedPointDifferential: 0, winProbability: null } }),
      candidate(best, { value: { expectedPointDifferential: 3, winProbability: null } }),
    ];
    const evalOut = evaluation({ candidates, playedAction: played, bestAction: best });
    const facts = buildReviewCoachingFacts(evalOut);
    expect(facts.missKind).toBe('pass_or_draw');
  });

  it('same_tile_wrong_end: same tile, different position -- and nothing in the shape implies a different tile', () => {
    const played = play(2, 2, 'right');
    const best = play(2, 2, 'left');
    const candidates = [
      candidate(played, { value: { expectedPointDifferential: 0, winProbability: null } }),
      candidate(best, { value: { expectedPointDifferential: 10, winProbability: null } }),
      // a genuine third choice so this isn't accidentally 'forced'
      candidate(play(5, 6), { value: { expectedPointDifferential: -5, winProbability: null } }),
    ];
    const evalOut = evaluation({ candidates, playedAction: played, bestAction: best });
    const facts = buildReviewCoachingFacts(evalOut);
    expect(facts.missKind).toBe('same_tile_wrong_end');
    expect(facts.played.action).toEqual(played);
    expect(facts.best.action).toEqual(best);
    // Explicit: the best action's tile must be the SAME tile as played --
    // nothing here should read as "you should have played a different tile".
    expect(facts.best.action.kind).toBe('play');
    if (facts.best.action.kind === 'play' && facts.played.action.kind === 'play') {
      expect(facts.best.action.tile).toEqual(facts.played.action.tile);
      expect(facts.best.action.position).not.toBe(facts.played.action.position);
    }
  });

  it('same_tile_wrong_end: tile identity is orientation-independent (low/high swapped)', () => {
    const played: ReviewAction = { kind: 'play', tile: { low: 6, high: 2 }, position: 'right' };
    const best: ReviewAction = { kind: 'play', tile: { low: 2, high: 6 }, position: 'left' };
    const candidates = [
      candidate(played, { value: { expectedPointDifferential: 0, winProbability: null } }),
      candidate(best, { value: { expectedPointDifferential: 10, winProbability: null } }),
      candidate(play(5, 6), { value: { expectedPointDifferential: -5, winProbability: null } }),
    ];
    const evalOut = evaluation({ candidates, playedAction: played, bestAction: best });
    const facts = buildReviewCoachingFacts(evalOut);
    expect(facts.missKind).toBe('same_tile_wrong_end');
  });
});

describe('buildReviewCoachingFacts -- different-tile misses (precise tier: exact/search)', () => {
  it('missed_score: the loss is almost entirely explained by this turn\'s own immediate points', () => {
    const played = play(0, 1);
    const best = play(5, 6);
    const candidates = [
      candidate(played, { value: { expectedPointDifferential: 0, winProbability: null }, immediatePoints: 0 }),
      candidate(best, { value: { expectedPointDifferential: 20, winProbability: null }, immediatePoints: 20 }),
    ];
    const evalOut = evaluation({ candidates, playedAction: played, bestAction: best });
    const facts = buildReviewCoachingFacts(evalOut);
    expect(facts.missKind).toBe('missed_score');
    expect(facts.deltas.expectedPointDifferential).toBe(20);
    expect(facts.deltas.immediatePoints).toBe(20);
  });

  it('reply_risk: the loss is almost entirely downstream -- immediate points are equal', () => {
    const played = play(0, 1);
    const best = play(5, 6);
    const candidates = [
      candidate(played, { value: { expectedPointDifferential: 0, winProbability: null }, immediatePoints: 10 }),
      candidate(best, { value: { expectedPointDifferential: 20, winProbability: null }, immediatePoints: 10 }),
    ];
    const evalOut = evaluation({ candidates, playedAction: played, bestAction: best });
    const facts = buildReviewCoachingFacts(evalOut);
    expect(facts.missKind).toBe('reply_risk');
    expect(facts.deltas.immediatePoints).toBe(0);
  });

  it('reply_risk: played scored MORE immediately but was still strategically worse overall', () => {
    const played = play(0, 1);
    const best = play(5, 6);
    const candidates = [
      candidate(played, { value: { expectedPointDifferential: 0, winProbability: null }, immediatePoints: 15 }),
      candidate(best, { value: { expectedPointDifferential: 20, winProbability: null }, immediatePoints: 10 }),
    ];
    const evalOut = evaluation({ candidates, playedAction: played, bestAction: best });
    const facts = buildReviewCoachingFacts(evalOut);
    expect(facts.missKind).toBe('reply_risk');
  });

  it('better_tile: no dominant signal -- immediate gap explains a middling share of the total loss', () => {
    const played = play(0, 1);
    const best = play(5, 6);
    const candidates = [
      candidate(played, { value: { expectedPointDifferential: 0, winProbability: null }, immediatePoints: 0 }),
      candidate(best, { value: { expectedPointDifferential: 20, winProbability: null }, immediatePoints: 10 }),
    ];
    const evalOut = evaluation({ candidates, playedAction: played, bestAction: best });
    const facts = buildReviewCoachingFacts(evalOut);
    // immediateGap=10, totalLoss=20 -> explainedByImmediate=0.5, strictly between the two thresholds.
    expect(facts.missKind).toBe('better_tile');
  });
});

describe('buildReviewCoachingFacts -- correct pick (played equals best, not forced)', () => {
  it('lands on correct when played already equals best and it was not forced', () => {
    const action = play(3, 4);
    const candidates = [
      candidate(action, { value: { expectedPointDifferential: 10, winProbability: null } }),
      candidate(play(1, 2), { value: { expectedPointDifferential: 2, winProbability: null } }),
    ];
    const evalOut = evaluation({ candidates, playedAction: action, bestAction: action });
    const facts = buildReviewCoachingFacts(evalOut);
    expect(facts.missKind).toBe('correct');
    expect(facts.deltas.expectedPointDifferential).toBe(0);
  });
});

describe('buildReviewCoachingFacts -- unknown fallback', () => {
  it('lands on unknown for a data-inconsistent precise-tier evaluation (different tile, non-positive totalLoss)', () => {
    const played = play(0, 1);
    const best = play(5, 6);
    // Deliberately inconsistent: different tiles chosen as played/best, but
    // their expectedPointDifferential values tie -- should never happen
    // from a real solver (best.value should exceed played.value whenever
    // they differ), so this must fail loud as 'unknown', not guess a shape.
    const candidates = [
      candidate(played, { value: { expectedPointDifferential: 10, winProbability: null }, immediatePoints: 0 }),
      candidate(best, { value: { expectedPointDifferential: 10, winProbability: null }, immediatePoints: 0 }),
    ];
    const evalOut = evaluation({ candidates, playedAction: played, bestAction: best });
    const facts = buildReviewCoachingFacts(evalOut);
    expect(facts.missKind).toBe('unknown');
  });

  it('throws on a genuinely malformed evaluation with zero candidates', () => {
    const action = play(0, 1);
    const malformed: ReviewEvaluationV1 = {
      ...evaluation({ candidates: [candidate(action)], playedAction: action }),
      candidates: [],
    };
    expect(() => buildReviewCoachingFacts(malformed)).toThrow();
  });
});

describe('buildReviewCoachingFacts -- heuristic-path input (zeroed values)', () => {
  function heuristicCandidate(action: ReviewAction, immediatePoints: number, rawScore: number): ReviewCandidateEvaluationV1 {
    return candidate(action, { value: { expectedPointDifferential: 0, winProbability: null }, immediatePoints, rawScore });
  }

  it('principalVariation comes back empty, not fabricated, for the heuristic path', () => {
    const played = play(0, 4);
    const best = play(3, 6);
    const candidates = [heuristicCandidate(played, 0, -15.77), heuristicCandidate(best, 0, 30.53)];
    const evalOut = evaluation({
      candidates,
      playedAction: played,
      bestAction: best,
      evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' },
    });
    const facts = buildReviewCoachingFacts(evalOut);
    expect(facts.principalVariation).toEqual([]);
  });

  it('missed_score still resolves on the heuristic path when immediatePoints genuinely differ (a real, non-heuristic signal)', () => {
    const played = play(0, 4);
    const best = play(3, 6);
    const candidates = [heuristicCandidate(played, 0, -15.77), heuristicCandidate(best, 20, 30.53)];
    const evalOut = evaluation({
      candidates,
      playedAction: played,
      bestAction: best,
      evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' },
    });
    const facts = buildReviewCoachingFacts(evalOut);
    expect(facts.missKind).toBe('missed_score');
  });

  it('lands on unknown on the heuristic path when immediatePoints are equal -- data is genuinely too limited to say why', () => {
    const played = play(0, 4);
    const best = play(3, 6);
    const candidates = [heuristicCandidate(played, 5, -15.77), heuristicCandidate(best, 5, 30.53)];
    const evalOut = evaluation({
      candidates,
      playedAction: played,
      bestAction: best,
      evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' },
    });
    const facts = buildReviewCoachingFacts(evalOut);
    expect(facts.missKind).toBe('unknown');
    expect(facts.deltas.expectedPointDifferential).toBe(0);
  });
});

describe('buildReviewCoachingFacts -- deltas and evidence passthrough', () => {
  it('keeps oracle loss separate from the displayed oracle-reference delta', () => {
    const played = play(0, 1);
    const best = play(5, 6);
    const candidates = [
      candidate(played, { value: { expectedPointDifferential: 2, winProbability: null } }),
      candidate(best, { value: { expectedPointDifferential: 7, winProbability: null } }),
    ];
    const facts = buildReviewCoachingFacts(evaluation({ candidates, playedAction: played, bestAction: best }));
    expect(facts.deltas.expectedPointDifferential).toBe(5);
    expect(facts.deltas.referenceExpectedPointDifferential).toBe(5);
  });

  it('makes a Fritz heuristic reference delta unavailable rather than treating zeroed oracle loss as a tie', () => {
    const played = play(0, 1, 'left');
    const fritz = play(0, 1, 'right');
    const oracle = play(5, 6, 'left');
    fritzReferenceSpy.mockReturnValueOnce({ action: fritz, immediatePoints: 0, isMinimaxEndgame: false });
    const facts = buildReviewCoachingFacts(
      evaluation({
        candidates: [candidate(played), candidate(oracle), candidate(fritz)],
        playedAction: played,
        bestAction: oracle,
        evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' },
      }),
      {} as ReviewPositionSnapshotV2,
      true,
    );
    expect(facts.referenceSource).toBe('fritz');
    expect(facts.best.action).toEqual(fritz);
    expect(facts.deltas.expectedPointDifferential).toBe(0);
    expect(facts.deltas.referenceExpectedPointDifferential).toBeUndefined();
  });

  it('omits winProbability from deltas when the evaluation has none', () => {
    const played = play(0, 1);
    const best = play(5, 6);
    const candidates = [
      candidate(played, { value: { expectedPointDifferential: 0, winProbability: null } }),
      candidate(best, { value: { expectedPointDifferential: 10, winProbability: null } }),
    ];
    const evalOut = evaluation({ candidates, playedAction: played, bestAction: best, winProbability: null });
    const facts = buildReviewCoachingFacts(evalOut);
    expect(facts.deltas.winProbability).toBeUndefined();
  });

  it('includes winProbability in deltas when the evaluation has a real one', () => {
    const played = play(0, 1);
    const best = play(5, 6);
    const candidates = [
      candidate(played, { value: { expectedPointDifferential: 0, winProbability: null } }),
      candidate(best, { value: { expectedPointDifferential: 10, winProbability: null } }),
    ];
    const evalOut = evaluation({ candidates, playedAction: played, bestAction: best, winProbability: 0.62 });
    const facts = buildReviewCoachingFacts(evalOut);
    expect(facts.deltas.winProbability).toBe(0.62);
  });

  it('passes evidence through unchanged', () => {
    const action = play(0, 1);
    const evidence: ReviewEvaluationV1['evidence'] = { source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' };
    const evalOut = evaluation({ candidates: [candidate(action)], playedAction: action, evidence });
    const facts = buildReviewCoachingFacts(evalOut);
    expect(facts.evidence).toEqual(evidence);
  });

  it('prose is not produced by this builder (D1)', () => {
    const action = play(0, 1);
    const evalOut = evaluation({ candidates: [candidate(action)], playedAction: action });
    const facts = buildReviewCoachingFacts(evalOut);
    expect(facts.prose).toBeUndefined();
  });
});

describe('default-off F2 compatibility', () => {
  const budget = { maxNodes: 200_000, maxHiddenStateSamples: 100, maxPlyDepth: 2, seed: 'racehorse-review-default-seed' };

  it('is byte-identical to main’s facts/prose contract across REVIEW_FIXTURE_CORPUS and never invokes Fritz', () => {
    for (const fixture of REVIEW_FIXTURE_CORPUS) {
      const evaluation = evaluateReviewPosition(fixture.snapshot, budget, 0.02);
      const facts = buildReviewCoachingFacts(evaluation, fixture.snapshot);
      const mainContractFacts = {
        played: { action: evaluation.played.action, immediatePoints: evaluation.played.immediatePoints },
        best: { action: evaluation.best.action, immediatePoints: evaluation.best.immediatePoints },
        missKind: facts.missKind,
        deltas: {
          immediatePoints: evaluation.best.immediatePoints - evaluation.played.immediatePoints,
          expectedPointDifferential: evaluation.loss.expectedPointDifferential,
          referenceExpectedPointDifferential: evaluation.loss.expectedPointDifferential,
          ...(evaluation.loss.winProbability !== null ? { winProbability: evaluation.loss.winProbability } : {}),
        },
        evidence: evaluation.evidence,
        principalVariation: evaluation.best.principalVariation,
      };
      expect(JSON.stringify(facts)).toBe(JSON.stringify(mainContractFacts));
      expect(JSON.stringify(buildReviewCoachingProse(facts))).toBe(JSON.stringify(buildReviewCoachingProse(mainContractFacts)));
    }
    expect(fritzReferenceSpy).not.toHaveBeenCalled();
  }, 60_000);
});

describe('buildReviewCoachingFacts -- real corpus fixtures (same fixtures as classifyHeuristicResult.test.ts, PR #232)', () => {
  // Real values from the merged evaluateReviewPosition dispatcher run
  // against packages/game-core's real fixture corpus -- not invented.

  it('opening-double-from-live-deal: 1 legal action -> forced', () => {
    const action = play(0, 0);
    const evalOut = evaluation({
      candidates: [candidate(action, { value: { expectedPointDifferential: 0, winProbability: null }, rawScore: -93.71428571428572 })],
      playedAction: action,
      evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' },
    });
    const facts = buildReviewCoachingFacts(evalOut);
    expect(facts.missKind).toBe('forced');
  });

  it('locked-yard-five-tile-endgame: 3 position-variants of the same tile remain distinct placements', () => {
    const played = play(2, 6, 'branch-1-0');
    const candidates = [
      candidate(play(2, 6, 'right'), { value: { expectedPointDifferential: 0, winProbability: null }, rawScore: 253.75 }),
      candidate(played, { value: { expectedPointDifferential: 0, winProbability: null }, rawScore: 253.75 }),
      candidate(play(2, 6, 'branch-1-1'), { value: { expectedPointDifferential: 0, winProbability: null }, rawScore: 251.25 }),
    ];
    const evalOut = evaluation({
      candidates,
      playedAction: played,
      bestAction: play(2, 6, 'right'),
      evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' },
    });
    const facts = buildReviewCoachingFacts(evalOut);
    expect(facts.missKind).toBe('same_tile_wrong_end');
  });

  it('hidden-allocation-ambiguous-midgame: 3 distinct tiles, real heuristic spread 82.24, played mid-pack -> a different-tile miss classified from real immediatePoints, not fabricated', () => {
    const played = play(3, 6, 'left');
    const best = play(0, 4, 'right');
    const candidates = [
      candidate(best, { value: { expectedPointDifferential: 0, winProbability: null }, rawScore: 30.530748663101605, immediatePoints: 0 }),
      candidate(played, { value: { expectedPointDifferential: 0, winProbability: null }, rawScore: -15.772727272727273, immediatePoints: 0 }),
      candidate(play(0, 1, 'right'), { value: { expectedPointDifferential: 0, winProbability: null }, rawScore: -51.70454545454545 }),
    ];
    const evalOut = evaluation({
      candidates,
      playedAction: played,
      bestAction: best,
      evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' },
    });
    const facts = buildReviewCoachingFacts(evalOut);
    // Real immediatePoints tie at 0 for both played and best in this corpus
    // fixture (rawScore is the only thing that differs, and it's not a real
    // point differential) -- honestly unknown, not a guessed bucket.
    expect(facts.missKind).toBe('unknown');
    expect(facts.principalVariation).toEqual([]);
  });
});
