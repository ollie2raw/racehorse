import { describe, expect, it, vi } from 'vitest';
import type { ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import type { GameAccuracyModelResult } from '@racehorse/review-engine';
import { persistMultiplayerReview } from './multiplayerReviewPersistence';

function snapshot(digest: string): ReviewPositionSnapshotV2 {
  return { integrity: { authorityPostStateDigest: digest } } as ReviewPositionSnapshotV2;
}

const evaluations = [{
  reviewEngineVersion: 'review-engine-v1',
}] as unknown as ReviewEvaluationV1[];

const accuracyModelResult = {
  accuracyModelVersion: 'accuracy-model-v1',
} as GameAccuracyModelResult;

describe('persistMultiplayerReview', () => {
  it('writes a cohort member review with the ordered MP digest and mode', async () => {
    const write = vi.fn();

    persistMultiplayerReview({
      enabled: true,
      snapshots: [snapshot('post-1'), snapshot('post-2')],
      evaluations,
      accuracyModelResult,
      sourceMatchId: 'room-123',
      write,
    });

    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write).toHaveBeenCalledWith({
      gameDigest: 'game-digest-v1:364bc694',
      reviewEngineVersion: 'review-engine-v1',
      accuracyModelVersion: 'accuracy-model-v1',
      evaluations,
      accuracyModelResult,
      mode: 'multiplayer',
      sourceMatchId: 'room-123',
    });
  });

  it('does not write for a non-cohort user', async () => {
    const write = vi.fn();

    persistMultiplayerReview({
      enabled: false,
      snapshots: [snapshot('post-1')],
      evaluations,
      accuracyModelResult,
      sourceMatchId: 'room-123',
      write,
    });

    await Promise.resolve();
    expect(write).not.toHaveBeenCalled();
  });

  it('absorbs a failed persistence call without throwing', async () => {
    const write = vi.fn().mockRejectedValue(new Error('network down'));

    expect(() => persistMultiplayerReview({
      enabled: true,
      snapshots: [snapshot('post-1')],
      evaluations,
      accuracyModelResult,
      sourceMatchId: 'room-123',
      write,
    })).not.toThrow();

    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  });
});
