import { beforeEach, describe, expect, it, vi } from 'vitest';
import { insertGameReviewIdempotent } from './insertGameReviewIdempotent';
import { supabaseFetch } from '../supabaseUtils';

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(),
}));

const mockedSupabaseFetch = vi.mocked(supabaseFetch);

const baseInput = {
  userId: '11111111-1111-4111-8111-111111111111',
  gameDigest: 'digest-abc123',
  reviewEngineVersion: 'review-engine-v1',
  accuracyModelVersion: 'accuracy-model-v4-calibrated-2026-09-17',
  evaluations: [{ decisionId: 'd1', evidence: { source: 'exact' } }],
  accuracyModelResult: { accuracy: 88.1, grade: 'A' },
  mode: 'pvf' as const,
};

const insertedRow = {
  id: 'review-row-1',
  user_id: baseInput.userId,
  game_digest: baseInput.gameDigest,
  review_engine_version: baseInput.reviewEngineVersion,
  accuracy_model_version: baseInput.accuracyModelVersion,
};

beforeEach(() => {
  mockedSupabaseFetch.mockReset();
});

describe('insertGameReviewIdempotent', () => {
  it('POSTs with on_conflict on the full idempotency key and ignore-duplicates', async () => {
    mockedSupabaseFetch.mockResolvedValue([insertedRow]);

    const result = await insertGameReviewIdempotent(baseInput);

    expect(result).toEqual({ isNew: true, review: insertedRow });
    expect(mockedSupabaseFetch).toHaveBeenCalledTimes(1);
    const [path, init] = mockedSupabaseFetch.mock.calls[0]!;
    expect(path).toBe(
      '/rest/v1/game_reviews?on_conflict=user_id,game_digest,review_engine_version,accuracy_model_version',
    );
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      Prefer: 'return=representation,resolution=ignore-duplicates',
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      user_id: baseInput.userId,
      game_digest: baseInput.gameDigest,
      review_engine_version: baseInput.reviewEngineVersion,
      accuracy_model_version: baseInput.accuracyModelVersion,
      mode: 'pvf',
    });
  });

  it('returns isNew false when ignore-duplicates yields no row (re-submitting the same version pair)', async () => {
    mockedSupabaseFetch.mockResolvedValue([]);

    const result = await insertGameReviewIdempotent(baseInput);

    expect(result).toEqual({ isNew: false, review: null });
  });

  it('a re-analysis under a newer accuracyModelVersion is a distinct row, not deduped against the old one', async () => {
    mockedSupabaseFetch.mockResolvedValue([insertedRow]);

    await insertGameReviewIdempotent({ ...baseInput, accuracyModelVersion: 'accuracy-model-v5' });

    const [path] = mockedSupabaseFetch.mock.calls[0]!;
    // Same game_digest, different accuracy_model_version in the on_conflict
    // target -> the unique index treats this as a new row, not a duplicate.
    expect(path).toBe(
      '/rest/v1/game_reviews?on_conflict=user_id,game_digest,review_engine_version,accuracy_model_version',
    );
  });
});
