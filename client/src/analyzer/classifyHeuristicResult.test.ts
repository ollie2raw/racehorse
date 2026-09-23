import { describe, expect, it } from 'vitest';
import type { ReviewAction, ReviewCandidateEvaluationV1, ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { isForcedDecision } from '@racehorse/game-core/review';
import {
  classifyHeuristicResult,
  dedupeCandidatesByTile,
  researchClassifierHeuristicSeverity,
} from './classifyHeuristicResult';

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
    expect(dedupeCandidatesByTile(candidates)).toHaveLength(3);
  });
});

describe('isForcedDecision — action-level (placement-distinct)', () => {
  it('one tile / one placement → forced', () => {
    expect(isForcedDecision([candidate(tileA(3, 4), 1)])).toBe(true);
  });

  it('one tile / two placements → NOT forced', () => {
    expect(
      isForcedDecision([
        candidate(tileAt(3, 4, 'left'), 10),
        candidate(tileAt(3, 4, 'right'), 40),
      ]),
    ).toBe(false);
  });

  it('branch A vs branch B → NOT forced', () => {
    expect(
      isForcedDecision([
        candidate(tileAt(2, 6, 'branch-1-0'), 10),
        candidate(tileAt(2, 6, 'branch-1-1'), 20),
      ]),
    ).toBe(false);
  });
});

describe('classifyHeuristicResult — production Estimate (no severity)', () => {
  it('one tile / one placement → Forced', () => {
    const action = tileA(0, 0);
    expect(
      classifyHeuristicResult(evaluation({ candidates: [candidate(action, -93)], playedAction: action })),
    ).toEqual({ kind: 'forced' });
  });

  it('one tile / two placements → Estimate, not Forced', () => {
    const played = tileAt(1, 5, 'left');
    const result = classifyHeuristicResult(
      evaluation({
        candidates: [candidate(played, 10), candidate(tileAt(1, 5, 'right'), 40)],
        playedAction: played,
      }),
    );
    expect(result).toEqual({ kind: 'estimate', matchedPrimary: false });
  });

  it('player matches Fritz → Estimate matchedPrimary, never Blunder', () => {
    const fritz = tileAt(2, 2, 'left');
    const oracleMax = tileA(5, 6);
    const result = classifyHeuristicResult(
      evaluation({
        candidates: [candidate(fritz, -40), candidate(oracleMax, 80), candidate(tileA(0, 1), -60)],
        playedAction: fritz,
      }),
      { primaryReferenceAction: fritz },
    );
    expect(result).toEqual({ kind: 'estimate', matchedPrimary: true });
    expect(result).not.toMatchObject({ kind: 'bucket' });
  });

  it('player differs from Fritz → Estimate, not severity', () => {
    const fritz = tileA(5, 6);
    const played = tileA(0, 1);
    const result = classifyHeuristicResult(
      evaluation({
        candidates: [candidate(played, -60), candidate(fritz, 80), candidate(tileA(2, 2), -40)],
        playedAction: played,
      }),
      { primaryReferenceAction: fritz },
    );
    expect(result).toEqual({ kind: 'estimate', matchedPrimary: false });
  });

  it('Fritz absent from candidate list → Unclear primary-absent, never fabricated Inaccuracy', () => {
    const fritz = tileA(6, 6);
    const played = tileA(0, 1);
    const result = classifyHeuristicResult(
      evaluation({
        candidates: [candidate(played, -60), candidate(tileA(5, 6), 80)],
        playedAction: played,
      }),
      { primaryReferenceAction: fritz },
    );
    expect(result).toEqual({ kind: 'unclear', reason: 'primary-absent' });
  });

  it('same-tile multi-placement corpus case is Estimate, not Forced', () => {
    const played = tileAt(2, 6, 'branch-1-0');
    const result = classifyHeuristicResult(
      evaluation({
        candidates: [
          candidate(tileAt(2, 6, 'right'), 253.75),
          candidate(played, 253.75),
          candidate(tileAt(2, 6, 'branch-1-1'), 251.25),
        ],
        playedAction: played,
      }),
    );
    expect(result.kind).toBe('estimate');
  });

  it('globally-infeasible → Unclear', () => {
    const played = tileA(2, 6);
    expect(
      classifyHeuristicResult(
        evaluation({
          candidates: [candidate(played, 97), candidate(tileA(2, 0), 28)],
          playedAction: played,
          heuristicFallbackReason: 'globally-infeasible',
        }),
      ),
    ).toEqual({ kind: 'unclear', reason: 'globally-infeasible' });
  });
});

describe('researchClassifierHeuristicSeverity — DEV ONLY provisional buckets', () => {
  it('still exposes n=3 boundary buckets for research', () => {
    const played = tileA(3, 4);
    const ev = evaluation({
      candidates: [candidate(tileA(1, 2), 100), candidate(played, 39), candidate(tileA(5, 6), 0)],
      playedAction: played,
    });
    expect(researchClassifierHeuristicSeverity(ev)).toEqual({ kind: 'bucket', bucket: 'Blunder' });
  });
});
