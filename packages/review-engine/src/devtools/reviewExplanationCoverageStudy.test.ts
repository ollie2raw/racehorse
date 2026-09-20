import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildReviewCoachingFacts } from '../../../../client/src/analyzer/reviewCoachingFacts';
import { buildReviewCoachingProse, referenceWinsFeature } from '../../../../client/src/analyzer/reviewCoachingProse';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';
import { classifyExplanationCoverage } from './reviewExplanationCoverageStudy';

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
});
