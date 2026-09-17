import { describe, expect, it } from 'vitest';
import {
  deserializeReviewCaptureRecordsFromJsonl,
  serializeReviewCaptureRecordsToJsonl,
  type ReviewCaptureRecord,
} from '../reviewCaptureSchema';

const fakeRecord = {
  batchTag: 'strong-policy-top-tier',
  corpusKind: 'daily-fritz-master',
  harnessVersion: 'test-harness-v1',
  policyId: 'test-policy',
  tier: 'master',
  seed: 's',
  gameIndex: 0,
  handNumber: 1,
  moveNumber: 1,
  actorId: 'player',
  budget: { maxNodes: 1, maxHiddenStateSamples: 1, maxPlyDepth: 1, seed: 'x' },
  coverageThreshold: 0.02,
  evaluation: { a: 1 },
} as unknown as ReviewCaptureRecord;

describe('serializeReviewCaptureRecordsToJsonl / deserializeReviewCaptureRecordsFromJsonl', () => {
  it('round-trips a single record', () => {
    const jsonl = serializeReviewCaptureRecordsToJsonl([fakeRecord]);
    expect(deserializeReviewCaptureRecordsFromJsonl(jsonl)).toEqual([fakeRecord]);
  });

  it('serializes an empty array to an empty string', () => {
    expect(serializeReviewCaptureRecordsToJsonl([])).toBe('');
  });

  it('deserializes an empty string to an empty array', () => {
    expect(deserializeReviewCaptureRecordsFromJsonl('')).toEqual([]);
  });

  it('one JSON object per line, trailing newline present only when non-empty', () => {
    const jsonl = serializeReviewCaptureRecordsToJsonl([fakeRecord, fakeRecord]);
    expect(jsonl.endsWith('\n')).toBe(true);
    expect(jsonl.split('\n').filter((line) => line.length > 0)).toHaveLength(2);
  });
});
