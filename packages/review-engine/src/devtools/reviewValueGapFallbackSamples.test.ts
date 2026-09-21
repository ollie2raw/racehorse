import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildReviewCoachingFacts } from '../../../../client/src/analyzer/reviewCoachingFacts';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';

describe('value-gap fallback recorded outliers', () => {
  it.each([
    'self-play:demo-ordinary-pvf-1:2:move-44',
    'self-play:demo-ordinary-pvf-1:4:move-41',
  ])('recomputes the candidate value gap for %s', decisionId => {
    const record = replayRecordedSelfPlay(resolve(process.cwd(), 'fixtures/recorded-self-play'))
      .find(item => item.snapshot.identifiers.decisionId === decisionId)!;
    const facts = buildReviewCoachingFacts(record.evaluation, record.snapshot, true);
    const actionKey = (action: unknown) => JSON.stringify(action);
    const played = record.evaluation.candidates.find(candidate => actionKey(candidate.action) === actionKey(record.evaluation.played.action))!;
    const best = record.evaluation.candidates.find(candidate => actionKey(candidate.action) === actionKey(record.evaluation.best.action))!;
    const directGap = best.value.expectedPointDifferential - played.value.expectedPointDifferential;
    expect(directGap).toBeGreaterThan(0);
    expect(facts.deltas.expectedPointDifferential).toBeCloseTo(directGap, 10);
  });
});
