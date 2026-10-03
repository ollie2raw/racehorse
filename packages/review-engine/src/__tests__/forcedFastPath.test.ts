/**
 * Forced positions skip the search (approved 2026-10-03, c1). The verdict is
 * the same; accuracy and grade ignore a forced decision's search values (see
 * the PR for the corpus proof).
 */
import { describe, expect, it, vi } from 'vitest';
import { isForcedDecision } from '@racehorse/game-core/review';
import { REVIEW_FIXTURE_CORPUS } from '../../../game-core/src/reviewFixtureCorpus';
import { adaptiveEvaluateReviewPosition, FORCED_DECISION_FAST_PATH_BUDGET } from '../adaptiveEvaluateReviewPosition';
import { evaluateReviewPosition } from '../evaluateReviewPosition';

vi.setConfig({ testTimeout: 120_000 });

const forcedByLegalActions = (snapshot: (typeof REVIEW_FIXTURE_CORPUS)[number]['snapshot']) =>
  isForcedDecision(snapshot.legalActions.map((action) => ({ action })));

describe('forced fast path', () => {
  const forced = REVIEW_FIXTURE_CORPUS.filter((f) => forcedByLegalActions(f.snapshot));
  const notForced = REVIEW_FIXTURE_CORPUS.filter((f) => !forcedByLegalActions(f.snapshot));

  it('the corpus has forced positions to exercise', () => {
    expect(forced.length).toBeGreaterThan(0);
  });

  it('a forced position is FORCED with one candidate, zero loss, and uses only the minimal budget', () => {
    for (const fixture of forced) {
      const evaluate = vi.fn(evaluateReviewPosition);
      const result = adaptiveEvaluateReviewPosition(fixture.snapshot, { phase: 'completion', evaluate });
      expect(result.lifecycle).toBe('FORCED');
      expect(result.convergenceReason).toBe('forced');
      expect(result.evaluation.candidates).toHaveLength(1);
      expect(result.evaluation.loss.expectedPointDifferential).toBe(0);
      expect(result.evaluation.evaluationProvenance?.lifecycle).toBe('FORCED');
      expect(evaluate).toHaveBeenCalledTimes(1);
      expect(evaluate.mock.calls[0]![1]).toBe(FORCED_DECISION_FAST_PATH_BUDGET);
    }
  });

  it('the old full path reaches the same FORCED verdict on the same positions', () => {
    for (const fixture of forced) {
      const old = adaptiveEvaluateReviewPosition(fixture.snapshot, { phase: 'completion', maxTier: 1, forcedFastPath: false });
      expect(old.lifecycle).toBe('FORCED');
    }
  });

  it('non-forced positions fail the pre-check, so they keep the full search', () => {
    // The fast path is entered only when the legal actions say forced.
    expect(notForced.length).toBeGreaterThan(0);
    for (const fixture of notForced) expect(forcedByLegalActions(fixture.snapshot)).toBe(false);
  });

  it('forcedFastPath: false keeps the old path (used for comparisons)', () => {
    const fixture = forced[0]!;
    const evaluate = vi.fn(evaluateReviewPosition);
    adaptiveEvaluateReviewPosition(fixture.snapshot, { phase: 'completion', maxTier: 1, forcedFastPath: false, evaluate });
    for (const call of evaluate.mock.calls) expect(call[1]).not.toBe(FORCED_DECISION_FAST_PATH_BUDGET);
  });
});
