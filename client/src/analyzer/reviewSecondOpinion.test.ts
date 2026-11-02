/**
 * The whole-hand second opinion changes what is SHOWN, never what is measured. An unconfirmed verdict is shown one grade softer
 * (Best -> Good, Inaccuracy -> Good, Mistake and Blunder -> Inaccuracy); a confirmed one, a missing one (live results, old saved
 * reviews, exact endgames) and a forced or heuristic decision are untouched; the loss, and so the accuracy number, never changes.
 */
import { describe, expect, it } from 'vitest';
import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { lossBandLabelForEvaluation, presentedLabelForEvaluation } from './gameAccuracyModel';
import { buildReviewCoachingFacts } from './reviewCoachingFacts';
import { buildReviewCoachingProse } from './reviewCoachingProse';
import { assertPresentationConsistency, buildReviewPresentationRecord, presentationLabel } from './reviewPresentationRecord';
import { calibratedRatingCoachingCopy } from './moveRatingCoachingCopy';

const a = { kind: 'play', tile: { low: 0, high: 1 }, position: 'left' } as const;
const b = { kind: 'play', tile: { low: 2, high: 3 }, position: 'left' } as const;
const cand = (action: typeof a | typeof b, value = 0) => ({
  action,
  value: { expectedPointDifferential: value, winProbability: null },
  immediatePoints: 0,
  principalVariation: [],
});

type Opinion = NonNullable<ReviewEvaluationV1['secondOpinion']>;
const opinion = (verdict: Opinion['verdict'], kind: Opinion['kind']): Opinion => ({ verdict, kind, samples: 60, rolloutMargin: verdict === 'confirmed' ? 2 : -1 });

/** `playedIsBest`: the played move is the review's best (loss 0); otherwise the played move is `b` with the given loss. */
function evaluation(loss: number, secondOpinion?: Opinion, source: 'exact' | 'search' | 'heuristic' = 'search', playedIsBest = loss === 0): ReviewEvaluationV1 {
  const best = cand(a, loss);
  const played = playedIsBest ? best : cand(b, 0);
  return {
    evaluationVersion: 1, snapshotId: 'x', rulesVersion: 1, reviewEngineVersion: 'review-engine-v1',
    evidence: source === 'heuristic' ? { source, confidence: 'low', displayLabel: 'Heuristic estimate' } : source === 'exact'
      ? { source, confidence: 'high', displayLabel: 'Exact analysis' } : { source, confidence: 'medium', displayLabel: 'Review Engine search' },
    played, best, candidates: [best, played === best ? cand(b, -loss) : played], loss: { expectedPointDifferential: loss, winProbability: null },
    search: { nodes: 1, depth: 0, hiddenStateSamples: 1, coverage: 1, complete: true }, diagnostics: [],
    ...(secondOpinion ? { secondOpinion } : {}),
  } as unknown as ReviewEvaluationV1;
}

describe('presentedLabelForEvaluation', () => {
  const softened: Array<[string, number, string, string]> = [
    ['Inaccuracy', 0.5, 'Inaccuracy', 'Good'],
    ['Mistake', 3, 'Mistake', 'Inaccuracy'],
    ['Blunder', 9, 'Blunder', 'Inaccuracy'],
  ];
  for (const [name, loss, band, shown] of softened) {
    it(`an unconfirmed ${name} is shown as ${shown}, and the loss band is untouched`, () => {
      const e = evaluation(loss, opinion('unconfirmed', 'error'));
      expect(lossBandLabelForEvaluation(e)).toBe(band);
      expect(presentedLabelForEvaluation(e)).toBe(shown);
    });
    it(`a confirmed ${name} is shown as it is`, () => {
      expect(presentedLabelForEvaluation(evaluation(loss, opinion('confirmed', 'error')))).toBe(band);
    });
    it(`a ${name} with no second opinion (live result, old review) is shown as it is`, () => {
      expect(presentedLabelForEvaluation(evaluation(loss))).toBe(band);
    });
  }

  it('an unconfirmed Best is shown as Good; a confirmed or missing one stays Best', () => {
    expect(presentedLabelForEvaluation(evaluation(0, opinion('unconfirmed', 'best')))).toBe('Good');
    expect(presentedLabelForEvaluation(evaluation(0, opinion('confirmed', 'best')))).toBe('Best');
    expect(presentedLabelForEvaluation(evaluation(0))).toBe('Best');
  });

  it('an error opinion on a move whose loss is within the Best tolerance does not soften it, and a Best opinion does not soften an error', () => {
    expect(presentedLabelForEvaluation(evaluation(0.05, opinion('unconfirmed', 'error'), 'search', false))).toBe('Best');
    expect(presentedLabelForEvaluation(evaluation(3, opinion('unconfirmed', 'best')))).toBe('Mistake');
  });

  it('forced decisions carry no label either way', () => {
    const e = evaluation(0, opinion('unconfirmed', 'best'));
    expect(presentedLabelForEvaluation({ ...e, candidates: [e.candidates[0]!] })).toBeNull();
  });
});

describe('every surface agrees on a softened verdict', () => {
  const cases: Array<[string, ReviewEvaluationV1]> = [
    ['unconfirmed Best', evaluation(0, opinion('unconfirmed', 'best'))],
    ['unconfirmed Inaccuracy', evaluation(0.5, opinion('unconfirmed', 'error'))],
    ['unconfirmed Mistake', evaluation(3, opinion('unconfirmed', 'error'))],
    ['unconfirmed Blunder', evaluation(9, opinion('unconfirmed', 'error'))],
  ];
  for (const [name, e] of cases) {
    it(`${name}: badge, headline and coaching copy do not contradict, and the invariant holds`, () => {
      const facts = buildReviewCoachingFacts(e);
      expect(facts.secondOpinionUnconfirmed).toBe(e.secondOpinion!.kind);
      const record = buildReviewPresentationRecord(e, facts);
      const headline = buildReviewCoachingProse(facts).headline;
      expect(assertPresentationConsistency(record, headline)).toEqual([]);
      expect(record.softenedBySecondOpinion).toBe(true);
      expect(headline).not.toMatch(/^Best move\./);
      expect(headline).not.toMatch(/\bby about\b/);
      const label = presentationLabel(record)!;
      const copy = calibratedRatingCoachingCopy(label as 'Good', 3, e.secondOpinion!.kind);
      expect(copy).not.toMatch(/major miss|meaningful miss|Top move/);
    });
  }

  it('a confirmed verdict reads exactly as it does with no second opinion at all', () => {
    for (const [loss, kind] of [[0, 'best'], [0.5, 'error'], [3, 'error'], [9, 'error']] as const) {
      const confirmed = evaluation(loss, opinion('confirmed', kind));
      const none = evaluation(loss);
      const facts = buildReviewCoachingFacts(confirmed);
      expect(facts.secondOpinionUnconfirmed).toBeUndefined();
      expect(facts).toEqual(buildReviewCoachingFacts(none));
      const record = buildReviewPresentationRecord(confirmed, facts);
      expect(record).toEqual(buildReviewPresentationRecord(none, buildReviewCoachingFacts(none)));
      expect(buildReviewCoachingProse(facts)).toEqual(buildReviewCoachingProse(buildReviewCoachingFacts(none)));
    }
  });

  it('an unsoftened Good on a move matching the reference is still a contradiction', () => {
    const e = evaluation(0);
    const record = { ...buildReviewPresentationRecord(e, buildReviewCoachingFacts(e)), classification: { kind: 'calibrated', label: 'Good' } as const };
    expect(assertPresentationConsistency(record, 'Best move.').length).toBeGreaterThan(0);
  });
});
