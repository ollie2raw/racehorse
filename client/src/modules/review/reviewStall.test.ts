import { describe, expect, it } from 'vitest';
import { REVIEW_POLL_MAX_MS, REVIEW_POLL_STALLED_MS, REVIEW_STALL_MS, isReviewStalled } from './reviewCompletionClient';

describe('a review that is not moving', () => {
  it('is stalled after 90 seconds without progress, not before', () => {
    expect(REVIEW_STALL_MS).toBe(90_000);
    expect(isReviewStalled(10_000 + 89_999, 10_000)).toBe(false);
    expect(isReviewStalled(10_000 + 90_000, 10_000)).toBe(true);
  });

  it('is polled more slowly than a moving one, because every poll reads the job row', () => {
    expect(REVIEW_POLL_STALLED_MS).toBeGreaterThan(REVIEW_POLL_MAX_MS);
  });
});
