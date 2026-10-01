import { afterEach, describe, expect, it, vi } from 'vitest';
import { REVIEW_FIXTURE_CORPUS } from '../../../packages/game-core/src/reviewFixtureCorpus';
import { InMemoryCheckpointStore } from '../../../packages/review-engine/src/durableReviewCompletionRuntime';
import {
  enqueueReviewCompletionJob,
  isReviewSweepEnabled,
  scheduleReviewCompletionSweep,
  setReviewCompletionStoreForTests,
  stopReviewCompletionSweepForTests,
} from './reviewCompletionWorker';

describe('REVIEW_SWEEP_ENABLED kill switch', () => {
  afterEach(() => {
    stopReviewCompletionSweepForTests();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([undefined, '', 'false', '1', 'TRUE', 'yes'])('is off for %j', (value) => {
    if (value === undefined) vi.stubEnv('REVIEW_SWEEP_ENABLED', undefined);
    else vi.stubEnv('REVIEW_SWEEP_ENABLED', value);
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    expect(isReviewSweepEnabled()).toBe(false);
    scheduleReviewCompletionSweep();
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it('schedules the periodic sweep only when exactly "true"', () => {
    vi.stubEnv('REVIEW_SWEEP_ENABLED', 'true');
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    scheduleReviewCompletionSweep();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it('accepts and persists a job without running a pass when off', async () => {
    vi.stubEnv('REVIEW_SWEEP_ENABLED', undefined);
    const store = new InMemoryCheckpointStore();
    const listClaimable = vi.spyOn(store, 'listClaimable');
    const claim = vi.spyOn(store, 'claim');
    setReviewCompletionStoreForTests(store);
    const snapshot = REVIEW_FIXTURE_CORPUS[0]!.snapshot;

    const job = await enqueueReviewCompletionJob({
      userId: 'kill-switch-user',
      gameDigest: `kill-switch-${Date.now()}`,
      sourceMatchId: 'kill-switch-match',
      snapshots: [snapshot],
      expectedDecisionIds: [snapshot.identifiers.decisionId],
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(listClaimable).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    const persisted = await store.get(job.jobId);
    expect(persisted?.status).toBe('pending');
    expect(persisted?.claimToken ?? null).toBeNull();
  });
});
