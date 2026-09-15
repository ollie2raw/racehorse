import { describe, expect, it } from 'vitest';
import type { ReviewAction, ReviewCandidateEvaluationV1, ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { classifyHeuristicResult, dedupeCandidatesByTile } from './classifyHeuristicResult';

function candidate(action: ReviewAction, rawScore: number | undefined): ReviewCandidateEvaluationV1 {
  return {
    action,
    value: { expectedPointDifferential: 0, winProbability: null },
    immediatePoints: 0,
    principalVariation: [],
    rawScore,
  };
}

function evaluation(args: {
  candidates: readonly ReviewCandidateEvaluationV1[];
  playedAction: ReviewAction;
  heuristicFallbackReason?: ReviewEvaluationV1['heuristicFallbackReason'];
}): ReviewEvaluationV1 {
  const played = args.candidates.find((c) => JSON.stringify(c.action) === JSON.stringify(args.playedAction))!;
  return {
    evaluationVersion: 1,
    snapshotId: 'x',
    rulesVersion: 1,
    reviewEngineVersion: 'review-engine-v1',
    evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' },
    played,
    best: args.candidates[0],
    candidates: args.candidates,
    loss: { expectedPointDifferential: 0, winProbability: null },
    search: { nodes: args.candidates.length, depth: 0, hiddenStateSamples: 0, coverage: 0, complete: true },
    diagnostics: [],
    heuristicFallbackReason: args.heuristicFallbackReason,
  };
}

const tileA = (low: number, high: number): ReviewAction => ({ kind: 'play', tile: { low, high }, position: 'left' });
const tileAt = (low: number, high: number, position: string): ReviewAction =>
  ({ kind: 'play', tile: { low, high }, position }) as ReviewAction;

describe('dedupeCandidatesByTile', () => {
  it('collapses same-tile, different-position candidates to one entry using the max rawScore', () => {
    const candidates = [
      candidate(tileAt(2, 6, 'right'), 253.75),
      candidate(tileAt(2, 6, 'branch-1-0'), 253.75),
      candidate(tileAt(2, 6, 'branch-1-1'), 251.25),
    ];
    const deduped = dedupeCandidatesByTile(candidates);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].rawScore).toBe(253.75);
  });

  it('keeps distinct tiles as separate entries', () => {
    const candidates = [candidate(tileA(0, 1), 10), candidate(tileA(0, 4), 20), candidate(tileA(3, 6), 30)];
    const deduped = dedupeCandidatesByTile(candidates);
    expect(deduped).toHaveLength(3);
  });

  it('is orientation-independent: (2,6) and a hypothetically-swapped (6,2) tile identity collapse together', () => {
    const candidates = [
      candidate({ kind: 'play', tile: { low: 2, high: 6 }, position: 'left' }, 10),
      // Tile objects in this codebase are always stored low<=high, but the
      // dedup key must not silently depend on that invariant holding --
      // construct a deliberately "reversed" tile to prove it's compared
      // canonically, not by raw low/high field equality.
      candidate({ kind: 'play', tile: { low: 6, high: 2 }, position: 'right' }, 40),
    ];
    const deduped = dedupeCandidatesByTile(candidates);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].rawScore).toBe(40);
  });

  it('never collapses pass/draw actions into a play action, or into each other by accident', () => {
    const candidates = [candidate(tileA(1, 2), 10), candidate({ kind: 'pass' }, 5), candidate({ kind: 'draw' }, 3)];
    const deduped = dedupeCandidatesByTile(candidates);
    expect(deduped).toHaveLength(3);
  });
});

describe('classifyHeuristicResult -- real corpus fixtures', () => {
  // All four numbers below are the actual values produced by running the
  // real, merged evaluateReviewPosition dispatcher against every fixture in
  // packages/game-core's real corpus at production defaults (maxNodes:
  // 200_000, maxHiddenStateSamples: 100, maxPlyDepth: 2, coverageThreshold:
  // 0.02) during Phase C's spread-calibration research pass -- not invented.
  // Of the corpus's 9 fixtures, only these 4 land on the heuristic path;
  // the other 5 route to search or exact and never populate rawScore, so
  // they aren't meaningful inputs to this heuristic-only classifier.

  it('opening-double-from-live-deal: 1 legal action -> forced', () => {
    const action = tileA(0, 0);
    const result = classifyHeuristicResult(
      evaluation({ candidates: [candidate(action, -93.71428571428572)], playedAction: action }),
    );
    expect(result).toEqual({ kind: 'forced' });
  });

  it('near-win-multi-choice-defense: 2 distinct tiles, deduped spread 1.5 -> unclear/flat-spread', () => {
    const played = tileAt(0, 3, 'left');
    const result = classifyHeuristicResult(
      evaluation({
        candidates: [
          candidate(tileAt(0, 6, 'left'), 3.5064935064935057),
          candidate(tileAt(0, 6, 'right'), 3.5064935064935057),
          candidate(played, 2.0064935064935057),
          candidate(tileAt(0, 3, 'right'), 2.0064935064935057),
        ],
        playedAction: played,
      }),
    );
    expect(result).toEqual({ kind: 'unclear', reason: 'flat-spread' });
  });

  it('hidden-allocation-ambiguous-midgame: 3 distinct tiles, real spread 82.24, played mid-pack -> bucket/Inaccuracy', () => {
    const played = tileAt(3, 6, 'left');
    const result = classifyHeuristicResult(
      evaluation({
        candidates: [
          candidate(tileAt(0, 4, 'right'), 30.530748663101605),
          candidate(played, -15.772727272727273),
          candidate(tileAt(0, 1, 'right'), -51.70454545454545),
        ],
        playedAction: played,
      }),
    );
    // Independently verified: spread = 30.5307...-(-51.7045...) = 82.235...;
    // normalizedLoss = (30.5307... - (-15.7727...)) / 82.235... ≈ 0.563 --
    // above 0.25, at or below 0.6 -> Inaccuracy.
    expect(result).toEqual({ kind: 'bucket', bucket: 'Inaccuracy' });
  });

  it('locked-yard-five-tile-endgame: 3 position-variants of the same tile -> dedup collapses to 1 -> forced (not unclear)', () => {
    const played = tileAt(2, 6, 'branch-1-0');
    const result = classifyHeuristicResult(
      evaluation({
        candidates: [
          candidate(tileAt(2, 6, 'right'), 253.75),
          candidate(played, 253.75),
          candidate(tileAt(2, 6, 'branch-1-1'), 251.25),
        ],
        playedAction: played,
        heuristicFallbackReason: 'locked-yard-infeasible',
      }),
    );
    expect(result).toEqual({ kind: 'forced' });
  });
});

describe('classifyHeuristicResult -- globally-infeasible short-circuit', () => {
  it('produces unclear/globally-infeasible even when the real spread is large (not flat)', () => {
    // Reuses the empirical research snapshot's real output: a genuinely
    // large spread (71) confirming B4 still differentiates the actor's own
    // candidates fine even when the opponent's hidden hand has zero
    // feasible models -- globally-infeasible must still short-circuit to
    // Unclear regardless, since it's a different kind of "not knowing".
    const played = tileA(2, 6);
    const result = classifyHeuristicResult(
      evaluation({
        candidates: [
          candidate(played, 97.02380952380953),
          candidate(tileA(2, 0), 28.023809523809526),
          candidate(tileA(2, 4), 26.023809523809526),
        ],
        playedAction: played,
        heuristicFallbackReason: 'globally-infeasible',
      }),
    );
    expect(result).toEqual({ kind: 'unclear', reason: 'globally-infeasible' });
  });
});

describe('classifyHeuristicResult -- boundary correctness (<=0.25 vs <=0.6 vs >0.6)', () => {
  // Three distinct tiles, spread fixed at exactly 100 (best=100, min=0) so
  // normalizedLoss = (100 - played) / 100 lands on an exact, easily
  // hand-verified boundary value.
  function boundaryEvaluation(playedScore: number): ReviewEvaluationV1 {
    const played = tileA(3, 4);
    return evaluation({
      candidates: [candidate(tileA(1, 2), 100), candidate(played, playedScore), candidate(tileA(5, 6), 0)],
      playedAction: played,
    });
  }

  it('normalizedLoss exactly 0.25 -> Good (inclusive boundary)', () => {
    expect(classifyHeuristicResult(boundaryEvaluation(75))).toEqual({ kind: 'bucket', bucket: 'Good' });
  });

  it('normalizedLoss 0.26 (just above the Good boundary) -> Inaccuracy', () => {
    expect(classifyHeuristicResult(boundaryEvaluation(74))).toEqual({ kind: 'bucket', bucket: 'Inaccuracy' });
  });

  it('normalizedLoss exactly 0.6 -> Inaccuracy (inclusive boundary)', () => {
    expect(classifyHeuristicResult(boundaryEvaluation(40))).toEqual({ kind: 'bucket', bucket: 'Inaccuracy' });
  });

  it('normalizedLoss 0.61 (just above the Inaccuracy boundary) -> Blunder', () => {
    expect(classifyHeuristicResult(boundaryEvaluation(39))).toEqual({ kind: 'bucket', bucket: 'Blunder' });
  });
});

describe('classifyHeuristicResult -- forced move', () => {
  it('a genuinely forced single-candidate decision produces forced, not unclear or a bucket', () => {
    const action = tileA(4, 5);
    const result = classifyHeuristicResult(evaluation({ candidates: [candidate(action, 12.5)], playedAction: action }));
    expect(result).toEqual({ kind: 'forced' });
  });

  it('two candidates that are position-variants of the same tile also collapse to forced, even though the raw candidate count was 2', () => {
    const played = tileAt(1, 5, 'left');
    const result = classifyHeuristicResult(
      evaluation({
        candidates: [candidate(played, 10), candidate(tileAt(1, 5, 'right'), 40)],
        playedAction: played,
      }),
    );
    expect(result).toEqual({ kind: 'forced' });
  });
});
