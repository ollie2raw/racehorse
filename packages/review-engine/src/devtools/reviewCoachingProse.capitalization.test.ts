import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REVIEW_FIXTURE_CORPUS } from '../../../game-core/src/reviewFixtureCorpus';
import { buildReviewCoachingFacts } from '../../../../client/src/analyzer/reviewCoachingFacts';
import { buildReviewCoachingProse } from '../../../../client/src/analyzer/reviewCoachingProse';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';
import { evaluateReviewPosition } from '../evaluateReviewPosition';

function expectSentenceStartsToBePresentable(prose: { headline: string; detail: string; takeaway: string }): void {
  for (const sentence of `${prose.headline} ${prose.detail} ${prose.takeaway}`.split(/(?<=[.!?])\s+/)) {
    const trimmed = sentence.trim();
    // A rendered sentence begins with normal capitalization, or with the
    // tile token that names the move (for example, "2-4 at left").
    expect(trimmed).toMatch(/^(?:[A-Z]|\d+-\d+\b)/);
  }
}

describe('review coaching prose corpus sentence capitalization', () => {
  const budget = { maxNodes: 200_000, maxHiddenStateSamples: 100, maxPlyDepth: 2, seed: 'racehorse-review-default-seed' };

  it('capitalizes every generated fixture and recorded-self-play sentence', () => {
    const fixtureFacts = REVIEW_FIXTURE_CORPUS.map((fixture) =>
      buildReviewCoachingFacts(evaluateReviewPosition(fixture.snapshot, budget, 0.02), fixture.snapshot, true),
    );
    const recordedFacts = replayRecordedSelfPlay(resolve(process.cwd(), 'fixtures/recorded-self-play'))
      .map(({ evaluation, snapshot }) => buildReviewCoachingFacts(evaluation, snapshot, true));
    for (const coachingFacts of [...fixtureFacts, ...recordedFacts]) {
      expectSentenceStartsToBePresentable(buildReviewCoachingProse(coachingFacts, true));
    }
  }, 240_000);
});
