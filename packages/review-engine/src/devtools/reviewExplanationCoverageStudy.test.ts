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
      expect(prose.headline).toContain('No meaningful positional difference');
    }
    for (const { facts, prose } of resolved) {
      expect(classifyExplanationCoverage(facts)?.resolved).toBe(true);
      expect(prose.headline).toMatch(/biggest gap: .+\.$/);
    }
  }, 60_000);

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
  }, 60_000);

  it('uses the rendered value-gap wording as the classifier contract', () => {
    const facts = records.map(({ evaluation, snapshot }) => buildReviewCoachingFacts(evaluation, snapshot, true))
      .find(facts => classifyRenderedExplanationProse(facts) === 'value-gap')!;
    const headline = buildReviewCoachingProse(facts, true).headline;
    expect(headline.includes('is worth about') || headline.includes(' scores ') && headline.includes(' immediately')).toBe(true);
    expect(classifyRenderedExplanationProse(facts)).toBe('value-gap');
  }, 60_000);

  it('does not treat a heuristic zeroed oracle loss as a displayed-reference tie', () => {
    const byId = (suffix: string) => records.find(record => record.snapshot.identifiers.decisionId.endsWith(suffix))!;
    const classify = (suffix: string) => classifyRenderedExplanationProse(buildReviewCoachingFacts(byId(suffix).evaluation, byId(suffix).snapshot, true));
    expect(classify(':0:move-31')).toBe('no-difference');
    expect(classifyNoDifferenceSplit(buildReviewCoachingFacts(byId(':0:move-31').evaluation, byId(':0:move-31').snapshot, true))).toBe('unavailable');
    const factsList = records.map(({ evaluation, snapshot }) => buildReviewCoachingFacts(evaluation, snapshot, true));
    const positional = factsList
      .find(facts => classifyRenderedExplanationProse(facts) === 'positional')!;
    expect(classifyRenderedExplanationProse(positional)).toBe('positional');
    const identical = factsList
      .find(facts => JSON.stringify(facts.played.action) === JSON.stringify(facts.best.action))!;
    expect(classifyRenderedExplanationProse(identical)).toBe('no-difference');
    expect(classifyNoDifferenceSplit(identical)).toBe('a');
  }, 60_000);
});
