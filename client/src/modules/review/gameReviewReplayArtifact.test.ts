import { describe, expect, it, vi } from 'vitest';
import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import type { GameAnalysis } from '../../analyzer/moveAnalyzer';
import type { ReviewCoachingFacts } from '../../analyzer/reviewCoachingFacts';
import { createReviewCoachingFactsStore } from './reviewCoachingFactsStore';
import {
  buildGameReviewReplayArtifact,
  GAME_REVIEW_REPLAY_ARTIFACT_VERSION,
} from './gameReviewReplayArtifact';
import { hydrateHistoricalGameReview } from './hydrateHistoricalGameReview';

function play(low: number, high: number) {
  return { kind: 'play' as const, tile: { low, high }, position: 'left' as const };
}

function evaluation(
  snapshotId: string,
  source: 'search' | 'heuristic' | 'exact',
  played = play(0, 1),
  best = play(2, 3),
): ReviewEvaluationV1 {
  const candidate = (action: typeof played, value: number) => ({
    action,
    value: { expectedPointDifferential: value, winProbability: null },
    immediatePoints: 0,
    principalVariation: [],
  });
  const evidence =
    source === 'exact'
      ? ({ source: 'exact', confidence: 'high', displayLabel: 'Exact analysis' } as const)
      : source === 'search'
        ? ({ source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' } as const)
        : ({ source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' } as const);
  return {
    evaluationVersion: 1,
    snapshotId,
    rulesVersion: 1,
    reviewEngineVersion: 'review-engine-v1',
    evidence,
    played: candidate(played, 0),
    best: candidate(best, 4),
    candidates: [candidate(played, 0), candidate(best, 4)],
    loss: { expectedPointDifferential: 4, winProbability: null },
    search: { nodes: 2, depth: 1, hiddenStateSamples: 0, coverage: 1, complete: true },
    diagnostics: [],
  };
}

function minimalAnalysis(moveNumbers: number[]): GameAnalysis {
  return {
    accuracy: 90,
    grade: 'A',
    analyzedAt: 1,
    analyzedMoves: moveNumbers.map((moveNumber) => ({
      moveNumber,
      action: 'place' as const,
      playedTile: [0, 1] as [number, number],
      score: 0,
      rating: 'Mistake' as const,
      explanation: 'test',
      handBefore: [],
      validMoves: [],
      boardEnds: [0, 0] as [number, number],
      boardState: [],
      boardRenderState: null,
      boardRenderStateAfterMove: null,
      handSnapshot: [],
      engineBestMove: null,
    })),
    timeline: [],
    hands: [],
    oracleMode: 'tier',
    tierPlayed: 'standard',
    oracleLabel: 'test',
    worstHandNumber: null,
    consequenceByMoveNumber: {},
  };
}

describe('F1e-5 historical replay artifact', () => {
  it('builds Path A artifact from the review store without duplicate Fritz constructions', () => {
    const buildFacts = vi.fn((evaluation: ReviewEvaluationV1): ReviewCoachingFacts => ({
      played: { action: evaluation.played.action, immediatePoints: 0 },
      best: { action: evaluation.best.action, immediatePoints: 0 },
      missKind: 'better_tile',
      deltas: {
        immediatePoints: 0,
        expectedPointDifferential: evaluation.loss.expectedPointDifferential,
        referenceExpectedPointDifferential: evaluation.loss.expectedPointDifferential,
      },
      evidence: evaluation.evidence,
      principalVariation: [],
      referenceSource: evaluation.evidence.source === 'heuristic' ? 'fritz' : 'oracle',
      agreement: {
        oracleVsFritz: 'disagree',
        playedMatch: 'neither',
        contested: evaluation.evidence.source !== 'exact',
      },
    }));

    const search = evaluation('d-search', 'search', play(0, 1), play(2, 3));
    const heuristic = evaluation('d-heur', 'heuristic', play(4, 5), play(5, 6));
    const store = createReviewCoachingFactsStore<ReviewCoachingFacts>('test-review');
    const decisionIdByMoveNumber = new Map([
      [1, 'd-search'],
      [2, 'd-heur'],
    ]);
    const evaluationsByDecisionId = new Map([
      ['d-search', search],
      ['d-heur', heuristic],
    ]);

    const artifact = buildGameReviewReplayArtifact({
      analysis: minimalAnalysis([1, 2]),
      evaluationsByDecisionId,
      decisionIdByMoveNumber,
      coachingFactsStore: store,
      buildFacts,
      enablePositionalExplanations: true,
      buildProse: (facts) => ({
        headline: `Contested: ${facts.referenceSource}`,
        detail: 'persisted detail',
        takeaway: 'persisted takeaway',
      }),
    });

    expect(artifact.artifactVersion).toBe(GAME_REVIEW_REPLAY_ARTIFACT_VERSION);
    expect(artifact.decisions).toHaveLength(2);
    expect(buildFacts).toHaveBeenCalledTimes(2);
    expect(store.byDecisionId.size).toBe(2);

    // Second build through the same store must not re-invoke buildFacts.
    buildGameReviewReplayArtifact({
      analysis: minimalAnalysis([1, 2]),
      evaluationsByDecisionId,
      decisionIdByMoveNumber,
      coachingFactsStore: store,
      buildFacts,
      enablePositionalExplanations: true,
      buildProse: (facts) => ({
        headline: String(facts.referenceSource),
        detail: 'x',
        takeaway: 'y',
      }),
    });
    expect(buildFacts).toHaveBeenCalledTimes(2);
  });

  it('hydrates identical decision identity, facts, and prose on reload', () => {
    const search = evaluation('d-search', 'search');
    const heuristic = evaluation('d-heur', 'heuristic');
    const store = createReviewCoachingFactsStore<ReviewCoachingFacts>('hydrate');
    const artifact = buildGameReviewReplayArtifact({
      analysis: minimalAnalysis([1, 2]),
      evaluationsByDecisionId: new Map([
        ['d-search', search],
        ['d-heur', heuristic],
      ]),
      decisionIdByMoveNumber: new Map([
        [1, 'd-search'],
        [2, 'd-heur'],
      ]),
      coachingFactsStore: store,
      buildFacts: (evaluation) => ({
        played: { action: evaluation.played.action, immediatePoints: 0 },
        best: { action: evaluation.best.action, immediatePoints: 0 },
        missKind: 'better_tile',
        deltas: {
          immediatePoints: 0,
          expectedPointDifferential: 4,
          referenceExpectedPointDifferential: 4,
        },
        evidence: evaluation.evidence,
        principalVariation: [],
        referenceSource: evaluation.evidence.source === 'heuristic' ? 'fritz' : 'oracle',
        agreement: { oracleVsFritz: 'disagree', playedMatch: 'neither', contested: true },
        featureDeltas: [
          { feature: 'handShapePlayableNext', playedValue: 1, referenceValue: 3, delta: 2 },
        ],
      }),
      enablePositionalExplanations: true,
      buildProse: (facts) => ({
        headline: `Contested: ${facts.referenceSource}`,
        detail: 'engines disagree',
        takeaway: 'second opinion',
      }),
    });

    const hydrated = hydrateHistoricalGameReview({
      id: 'review-1',
      evaluations: [search, heuristic],
      accuracyModelResult: { accuracy: 90 },
      replayArtifact: artifact,
      source: 'client-asserted',
    });

    expect(hydrated.hasReplayArtifact).toBe(true);
    expect(hydrated.legacyNotice).toBeNull();
    expect(hydrated.decisionIdByMoveNumber.get(1)).toBe('d-search');
    expect(hydrated.decisionIdByMoveNumber.get(2)).toBe('d-heur');
    expect(hydrated.historicalCoachingByDecisionId.get('d-search')?.prose.headline).toBe(
      'Contested: oracle',
    );
    expect(hydrated.historicalCoachingByDecisionId.get('d-heur')?.prose.headline).toBe(
      'Contested: fritz',
    );
    expect(hydrated.historicalCoachingByDecisionId.get('d-search')?.facts.agreement?.contested).toBe(
      true,
    );
    expect(hydrated.analysis.analyzedMoves.map((m) => m.moveNumber)).toEqual([1, 2]);
    expect(hydrated.reviewWorkerBatch.resultsByDecisionId.get('d-search')).toEqual(search);
  });

  it('marks legacy rows without recomputing', () => {
    const hydrated = hydrateHistoricalGameReview({
      id: 'legacy-1',
      evaluations: [evaluation('d1', 'search')],
      accuracyModelResult: { accuracy: 80 },
      replayArtifact: null,
      source: 'client-asserted',
    });
    expect(hydrated.hasReplayArtifact).toBe(false);
    expect(hydrated.legacyNotice).toMatch(/before replayable explanations/);
    expect(hydrated.historicalCoachingByDecisionId.size).toBe(0);
  });
});
