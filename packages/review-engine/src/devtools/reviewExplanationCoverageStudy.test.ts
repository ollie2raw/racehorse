import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildReviewCoachingFacts } from '../../../../client/src/analyzer/reviewCoachingFacts';
import { buildReviewCoachingProse, referenceWinsFeature } from '../../../../client/src/analyzer/reviewCoachingProse';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';
import { classifyExplanationCoverage, classifyNoDifferenceSplit, classifyRenderedExplanationProse, unresolvedValueGapMagnitude } from './reviewExplanationCoverageStudy';

describe('review explanation coverage classification', () => {
  const records = replayRecordedSelfPlay(resolve(process.cwd(), 'fixtures/recorded-self-play'));

  it('keeps resolution buckets aligned with enabled rendered prose', () => {
    const cases = records
      .filter(record => record.evaluation.candidates.length > 1)
      .map(({ evaluation, snapshot }) => {
        const facts = buildReviewCoachingFacts(evaluation, snapshot, true);
        return { facts, prose: buildReviewCoachingProse(facts, true) };
      });
    const unresolved = cases.filter(({ facts }) => !(facts.featureDeltas ?? []).some(referenceWinsFeature)).slice(0, 3);
    const resolved = cases.filter(({ facts }) => (facts.featureDeltas ?? []).some(referenceWinsFeature)).slice(0, 3);
    expect(unresolved).toHaveLength(3);
    expect(resolved).toHaveLength(3);

    for (const { facts, prose } of unresolved) {
      expect(classifyExplanationCoverage(facts)?.resolved).toBe(false);
      expect(prose.headline).not.toMatch(/biggest gap:|rates better on/i);
    }
    for (const { facts, prose } of resolved) {
      expect(classifyExplanationCoverage(facts)?.resolved).toBe(true);
      expect(prose.headline).not.toMatch(/biggest gap:/i);
      expect(prose.headline.length).toBeGreaterThan(0);
    }
  }, 180_000);

  it('classifies backed value gaps from recorded self-play facts', () => {
    const unresolved = records
      .map(({ evaluation, snapshot }) => ({ facts: buildReviewCoachingFacts(evaluation, snapshot, true) }))
      .filter(({ facts }) => classifyExplanationCoverage(facts)?.resolved === false);
    const zeroGap = unresolved.filter(({ facts }) => unresolvedValueGapMagnitude(facts) === 0).slice(0, 3);
    const nonzeroGap = unresolved.filter(({ facts }) => (unresolvedValueGapMagnitude(facts) ?? 0) > 0).slice(0, 3);
    expect(zeroGap).toHaveLength(3);
    expect(nonzeroGap).toHaveLength(3);

    for (const { facts } of zeroGap) {
      expect(facts.deltas.expectedPointDifferential).toBe(0);
      expect(facts.deltas.immediatePoints).toBe(0);
      expect(unresolvedValueGapMagnitude(facts)).toBe(0);
    }
    for (const { facts } of nonzeroGap) {
      expect(facts.deltas.expectedPointDifferential !== 0 || facts.deltas.immediatePoints !== 0).toBe(true);
      expect(unresolvedValueGapMagnitude(facts)).toBeGreaterThan(0);
    }
  }, 180_000);

  it('uses the rendered value-gap wording as the classifier contract', () => {
    const facts = records.map(({ evaluation, snapshot }) => buildReviewCoachingFacts(evaluation, snapshot, true))
      .find(facts => classifyRenderedExplanationProse(facts) === 'value-gap')!;
    const headline = buildReviewCoachingProse(facts, true).headline;
    expect(
      (headline.includes('prefers') && headline.includes('overall'))
      || headline.includes('is worth about')
      || (headline.includes(' scores ') && headline.includes(' immediately')),
    ).toBe(true);
    expect(classifyRenderedExplanationProse(facts)).toBe('value-gap');
  }, 180_000);

  it('uses the rendered true-equality wording as the classifier contract', () => {
    const facts = records.map(({ evaluation, snapshot }) => buildReviewCoachingFacts(evaluation, snapshot, true))
      .find(facts => classifyRenderedExplanationProse(facts) === 'equal-value')!;
    const headline = buildReviewCoachingProse(facts, true).headline.replace(/^Contested:\s*/, '');
    expect(facts.deltas.referenceExpectedPointDifferential).toBe(0);
    expect(headline.startsWith('The review rates these two moves even overall')).toBe(true);
    expect(classifyRenderedExplanationProse(facts)).toBe('equal-value');
  }, 180_000);

  it('does not treat a heuristic zeroed oracle loss as a displayed-reference tie', () => {
    const byId = (suffix: string) => records.find(record => record.snapshot.identifiers.decisionId.endsWith(suffix))!;
    const move31Facts = buildReviewCoachingFacts(byId(':0:move-31').evaluation, byId(':0:move-31').snapshot, true);
    const move31Bucket = classifyRenderedExplanationProse(move31Facts);
    // Heuristic Fritz-relative expected value is unavailable by design — must
    // never be classified as a true displayed-reference equality tie.
    expect(move31Bucket).not.toBe('equal-value');
    expect(move31Facts.deltas.referenceExpectedPointDifferential).toBeUndefined();
    expect(buildReviewCoachingProse(move31Facts, true).headline).not.toMatch(/even overall/i);
    expect(classifyNoDifferenceSplit(move31Facts)).not.toBe('b');
    const factsList = records.map(({ evaluation, snapshot }) => buildReviewCoachingFacts(evaluation, snapshot, true));
    const positional = factsList
      .find(facts => classifyRenderedExplanationProse(facts) === 'positional')!;
    expect(classifyRenderedExplanationProse(positional)).toBe('positional');
    const identical = factsList
      .find(facts => JSON.stringify(facts.played.action) === JSON.stringify(facts.best.action) && facts.missKind !== 'forced')!;
    // Matched reference now renders affirmative coaching ("Best move."), not
    // the old self-comparison "no meaningful difference" bucket.
    expect(buildReviewCoachingProse(identical, true).headline).toMatch(/Best move/i);
    expect(classifyRenderedExplanationProse(identical)).toBe('positional');
    expect(classifyNoDifferenceSplit(identical)).toBeNull();
  }, 180_000);
});
