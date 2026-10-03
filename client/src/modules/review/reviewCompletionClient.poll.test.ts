import { describe, expect, it } from 'vitest';
import { nextReviewPollDelayMs, REVIEW_POLL_INITIAL_MS, REVIEW_POLL_MAX_MS } from './reviewCompletionClient.ts';

describe('review poll cadence', () => {
  it('backs off from 3 s to a 5 s ceiling while nothing changes', () => {
    let delay = nextReviewPollDelayMs(REVIEW_POLL_INITIAL_MS, true);
    expect(delay).toBe(3_000);
    delay = nextReviewPollDelayMs(delay, false);
    expect(delay).toBe(4_500);
    delay = nextReviewPollDelayMs(delay, false);
    expect(delay).toBe(REVIEW_POLL_MAX_MS);
    expect(nextReviewPollDelayMs(delay, false)).toBe(REVIEW_POLL_MAX_MS);
  });

  it('returns to 3 s as soon as progress moves', () => {
    expect(nextReviewPollDelayMs(REVIEW_POLL_MAX_MS, true)).toBe(REVIEW_POLL_INITIAL_MS);
  });
});
