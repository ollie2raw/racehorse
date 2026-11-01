import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REVIEW_SAVE_PENDING_MESSAGE,
  REVIEW_SAVE_REFUSED_MESSAGE,
  postGameReviewWrite,
  type PostGameReviewWriteBody,
} from './postGameReviewWrite.ts';
import { listReviewWriteOutbox, resetReviewWriteOutboxForTests } from './reviewWriteOutbox.ts';

const apiPost = vi.fn();
vi.mock('../../api/client.ts', () => ({ apiPost: (...args: unknown[]) => apiPost(...args) }));

let session: { token: string | null; userId: string | null } | null = { token: 't', userId: 'user-a' };
vi.mock('../../auth/sessionToken.ts', () => ({ peekCachedSession: () => session }));

const body: PostGameReviewWriteBody = {
  gameDigest: 'digest-1',
  reviewEngineVersion: 'engine-v',
  accuracyModelVersion: 'accuracy-v',
  evaluations: [],
  accuracyModelResult: {} as PostGameReviewWriteBody['accuracyModelResult'],
  mode: 'pvf',
};

describe('postGameReviewWrite', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetReviewWriteOutboxForTests();
    apiPost.mockReset();
    session = { token: 't', userId: 'user-a' };
  });
  afterEach(() => vi.useRealTimers());

  it('saves on the first try and empties the outbox', async () => {
    apiPost.mockResolvedValue({ data: {}, error: null, status: 201 });
    const onFailure = vi.fn();
    const onSaved = vi.fn();
    postGameReviewWrite(body, onFailure, onSaved);
    await vi.advanceTimersByTimeAsync(0);
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
    expect(listReviewWriteOutbox()).toHaveLength(0);
  });

  it('keeps the review and retries with backoff after a transient failure, then reports it saved', async () => {
    apiPost
      .mockResolvedValueOnce({ data: null, error: 'down', status: 503 })
      .mockResolvedValueOnce({ data: null, error: 'down', status: 503 })
      .mockResolvedValue({ data: {}, error: null, status: 201 });
    const onFailure = vi.fn();
    const onSaved = vi.fn();
    postGameReviewWrite(body, onFailure, onSaved);
    await vi.advanceTimersByTimeAsync(0);
    expect(onFailure).toHaveBeenCalledWith(REVIEW_SAVE_PENDING_MESSAGE);
    expect(listReviewWriteOutbox()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(apiPost).toHaveBeenCalledTimes(3);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(listReviewWriteOutbox()).toHaveLength(0);
  });

  it('stops retrying when the server refuses the review for good', async () => {
    apiPost.mockResolvedValue({ data: null, error: 'bad', status: 400 });
    const onFailure = vi.fn();
    const onSaved = vi.fn();
    postGameReviewWrite(body, onFailure, onSaved);
    await vi.advanceTimersByTimeAsync(200_000);
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith(REVIEW_SAVE_REFUSED_MESSAGE);
    expect(onSaved).not.toHaveBeenCalled();
    expect(listReviewWriteOutbox()).toHaveLength(0);
  });

  it('gives up retrying in this session after the last backoff but leaves the review queued for the next load', async () => {
    apiPost.mockResolvedValue({ data: null, error: 'down', status: 503 });
    postGameReviewWrite(body, vi.fn(), vi.fn());
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    // First try + five backoff retries.
    expect(apiPost).toHaveBeenCalledTimes(6);
    expect(listReviewWriteOutbox()).toHaveLength(1);
  });

  it('does one honest attempt, with no promise to keep trying, when nobody is signed in', async () => {
    session = null;
    apiPost.mockResolvedValue({ data: null, error: 'Unauthorized', status: 401 });
    const onFailure = vi.fn();
    postGameReviewWrite(body, onFailure);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith(REVIEW_SAVE_REFUSED_MESSAGE);
    expect(listReviewWriteOutbox()).toHaveLength(0);
  });

  describe('contract kept from E1 (single attempt, fire-and-forget)', () => {
    beforeEach(() => { session = null; });

    it('fires POST /api/game-reviews with the exact body it was given', async () => {
      apiPost.mockResolvedValue({ data: null, error: null });
      postGameReviewWrite(body);
      await vi.advanceTimersByTimeAsync(0);
      expect(apiPost).toHaveBeenCalledTimes(1);
      expect(apiPost).toHaveBeenCalledWith('/api/game-reviews', body);
    });

    it('returns void, not the underlying promise', () => {
      apiPost.mockResolvedValue({ data: null, error: null });
      expect(postGameReviewWrite(body)).toBeUndefined();
    });

    it('a rejected request never throws or leaves an unhandled rejection', async () => {
      apiPost.mockRejectedValue(new Error('network error'));
      const onFailure = vi.fn();
      expect(() => postGameReviewWrite(body, onFailure)).not.toThrow();
      await vi.advanceTimersByTimeAsync(0);
      expect(onFailure).toHaveBeenCalledWith(REVIEW_SAVE_REFUSED_MESSAGE);
    });

    it('reports a failed save to the player-facing caller', async () => {
      apiPost.mockResolvedValue({ data: null, error: 'server unavailable' });
      const failure = vi.fn();
      postGameReviewWrite(body, failure);
      await vi.advanceTimersByTimeAsync(0);
      expect(failure).toHaveBeenCalledWith(expect.stringContaining('could not be saved to your history'));
    });
  });
});
