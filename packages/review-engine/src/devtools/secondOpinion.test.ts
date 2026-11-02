import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';
import { rolloutGain, sampleAllocations } from '../rolloutValue';
import { adaptiveEvaluateReviewPosition } from '../adaptiveEvaluateReviewPosition';
import { computeSecondOpinion, SECOND_OPINION_BEST_MARGIN, SECOND_OPINION_TIER } from '../secondOpinion';

const CORPUS = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/recorded-self-play');
const SAMPLES = 20;

const all = replayRecordedSelfPlay(CORPUS);
const searchable = all.filter(
  ({ snapshot, evaluation }) =>
    evaluation.evidence.source === 'search' && evaluation.candidates.length > 1 && snapshot.preAction.boneyard.drawableCount > 0,
);
const errors = searchable.filter(({ evaluation }) => JSON.stringify(evaluation.played.action) !== JSON.stringify(evaluation.best.action)).slice(0, 6);
const bests = searchable.filter(({ evaluation }) => JSON.stringify(evaluation.played.action) === JSON.stringify(evaluation.best.action)).slice(0, 6);

describe('computeSecondOpinion', () => {
  it('has search decisions of both kinds to test against', () => {
    expect(errors.length).toBeGreaterThan(0);
    expect(bests.length).toBeGreaterThan(0);
  });

  it('is deterministic: the same decision gives the same answer', () => {
    for (const { snapshot, evaluation } of [...errors, ...bests].slice(0, 4)) {
      expect(computeSecondOpinion(snapshot, evaluation, { samples: SAMPLES })).toEqual(computeSecondOpinion(snapshot, evaluation, { samples: SAMPLES }));
    }
  });

  it('confirms an error verdict exactly when the review best beats the played move in the rollout', () => {
    for (const { snapshot, evaluation } of errors) {
      const result = computeSecondOpinion(snapshot, evaluation, { samples: SAMPLES })!;
      expect(result.kind).toBe('error');
      const allocations = sampleAllocations(snapshot, 'second-opinion', SAMPLES);
      const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
      const margin =
        mean(allocations.map((a) => rolloutGain(snapshot, a, evaluation.best.action!, SECOND_OPINION_TIER))) -
        mean(allocations.map((a) => rolloutGain(snapshot, a, evaluation.played.action, SECOND_OPINION_TIER)));
      expect(result.rolloutMargin).toBeCloseTo(margin, 9);
      expect(result.verdict).toBe(margin > 0 ? 'confirmed' : 'unconfirmed');
    }
  });

  it('leaves a Best unconfirmed only when another move is better by more than the margin', () => {
    for (const { snapshot, evaluation } of bests) {
      const result = computeSecondOpinion(snapshot, evaluation, { samples: SAMPLES })!;
      expect(result.kind).toBe('best');
      expect(result.verdict).toBe(result.rolloutMargin > SECOND_OPINION_BEST_MARGIN ? 'unconfirmed' : 'confirmed');
    }
  });

  it('says nothing about evidence that is not a search, a forced decision, or a position without a draw pile', () => {
    for (const { snapshot, evaluation } of all) {
      const result = computeSecondOpinion(snapshot, evaluation, { samples: SAMPLES });
      const eligible =
        evaluation.evidence.source === 'search' && evaluation.candidates.length > 1 && snapshot.preAction.boneyard.drawableCount > 0;
      if (!eligible) expect(result).toBeNull();
    }
  });

  it('declines when too few consistent hands exist', () => {
    const { snapshot, evaluation } = errors[0]!;
    expect(computeSecondOpinion(snapshot, evaluation, { samples: 3 })).toBeNull();
  });
});

describe('second opinion in the production escalation', () => {
  const sample = searchable.slice(0, 5);

  it('is attached by the completion pass to a scored search decision, and agrees with computeSecondOpinion', () => {
    let attached = 0;
    for (const { snapshot } of sample) {
      const result = adaptiveEvaluateReviewPosition(snapshot, { phase: 'completion', startTier: 2, maxTier: 2 });
      if (result.lifecycle !== 'SCORED' || result.evaluation.evidence.source !== 'search') continue;
      expect(result.evaluation.secondOpinion).toEqual(computeSecondOpinion(snapshot, result.evaluation));
      if (result.evaluation.secondOpinion) attached += 1;
    }
    expect(attached).toBeGreaterThan(0);
  });

  it('is left off the live pass', () => {
    for (const { snapshot } of sample) {
      const result = adaptiveEvaluateReviewPosition(snapshot, { phase: 'live', startTier: 1, maxTier: 1 });
      expect(result.evaluation.secondOpinion).toBeUndefined();
    }
  });
});
