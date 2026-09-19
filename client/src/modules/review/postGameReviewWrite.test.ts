import { describe, expect, it, vi } from 'vitest';
import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { apiPost } from '../../api/client';
import { postGameReviewWrite } from './postGameReviewWrite.ts';

vi.mock('../../api/client', () => ({
  apiPost: vi.fn(),
}));

const mockedApiPost = vi.mocked(apiPost);

const evaluation = { evaluationVersion: 1, reviewEngineVersion: 'review-engine-v1' } as unknown as ReviewEvaluationV1;

const body = {
  gameDigest: 'game-digest-v1:deadbeef',
  reviewEngineVersion: 'review-engine-v1',
  accuracyModelVersion: 'accuracy-model-v4-calibrated-2026-09-17',
  evaluations: [evaluation],
  accuracyModelResult: { accuracy: 88.1, grade: 'A' } as never,
  mode: 'pvf' as const,
  sourceMatchId: 'match-uuid-1',
};

describe('postGameReviewWrite', () => {
  it('E1: fires POST /api/game-reviews with the exact body it was given', () => {
    mockedApiPost.mockResolvedValue({ data: null, error: null });

    postGameReviewWrite(body);

    expect(mockedApiPost).toHaveBeenCalledTimes(1);
    expect(mockedApiPost).toHaveBeenCalledWith('/api/game-reviews', body);
  });

  it('E1: is fire-and-forget -- returns void, does not return the underlying promise', () => {
    mockedApiPost.mockResolvedValue({ data: null, error: null });
    const result = postGameReviewWrite(body);
    expect(result).toBeUndefined();
  });

  it('E1: a rejected apiPost call never throws or produces an unhandled rejection -- mirrors ingestDailyFritzNextHandDebug\'s isolation pattern', async () => {
    mockedApiPost.mockRejectedValue(new Error('network error'));

    expect(() => postGameReviewWrite(body)).not.toThrow();

    // Let the microtask queue drain so the rejected promise's .catch(() =>
    // {}) has actually run -- if it were missing, vitest's unhandled
    // rejection detection would fail this test.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
